// --- 1. STATE ---
let appState = {
  candidate: { name: '', exp: '', pos: '', date: '', interviewer: '', round: 'Round 1' },
  questions: [],
  settings: { activeQuestions: {} },
  session: { scores: {}, notes: {}, asked: {}, overallNote: '' }
};

let currentCategoryFilter = 'all';
let currentTrackFilter = 'all';
let currentPage = 1;
let settingsSearchTerm = '';
let settingsCategoryFilter = 'all';
let settingsCustomOnly = false;
const QUESTIONS_PER_SECTION = 50;
let chartInstance = null;

const CATEGORIES = [
  { id: 'api', label: 'API Testing' },
  { id: 'automation', label: 'Automation' },
  { id: 'behavioural', label: 'Behavioural' },
  { id: 'bluff', label: 'Bluff Detectors' },
  { id: 'manual', label: 'Manual Testing' },
  { id: 'performance', label: 'Performance' },
  { id: 'postman', label: 'Postman' },
  { id: 'practical', label: 'Practical Testing' },
  { id: 'sql', label: 'SQL & Data' }
];

const TRACK_LABELS = {
  'manual-testing': 'Manual Testing',
  'api-testing': 'API Testing',
  'postman': 'Postman',
  'jmeter': 'JMeter',
  'sql-data': 'SQL & Data',
  'automation': 'Automation',
  'practical-testing': 'Practical Testing',
  'behavioural': 'Behavioural',
  'bug-management': 'Bug Management',
  'test-design': 'Test Design',
  'process-quality': 'Process & Quality',
  'mobile-web': 'Mobile/Web',
  'tools-ci': 'Tools & CI'
};

function mapCategoryToTrack(category) {
  if (category === 'api') return 'api-testing';
  if (category === 'postman') return 'postman';
  if (category === 'sql') return 'sql-data';
  if (category === 'automation') return 'automation';
  if (category === 'performance') return 'jmeter';
  if (category === 'practical') return 'practical-testing';
  if (category === 'behavioural') return 'behavioural';
  if (category === 'bluff') return 'tools-ci';
  return 'manual-testing';
}

function getSortedCategories() {
  return [...CATEGORIES].sort((a, b) => a.label.localeCompare(b.label));
}

function getTrackLabel(trackId) {
  return TRACK_LABELS[trackId] || trackId;
}

function enrichQuestionMetadata(q) {
  if (!q.primaryTrack) {
    q.primaryTrack = mapCategoryToTrack(q.category);
  }
  if (!Array.isArray(q.tags)) {
    q.tags = [];
  }
  const tagSet = new Set(q.tags.filter(Boolean));
  tagSet.add(q.category || 'manual');
  tagSet.add(q.primaryTrack);
  q.tags = Array.from(tagSet);
  return q;
}

function getAvailableTracks() {
  const counts = {};
  appState.questions.forEach(q => {
    if (!appState.settings.activeQuestions[q.id]) return;
    const track = q.primaryTrack || mapCategoryToTrack(q.category);
    counts[track] = (counts[track] || 0) + 1;
  });
  return Object.keys(counts)
    .sort((a, b) => getTrackLabel(a).localeCompare(getTrackLabel(b)))
    .map(track => ({ id: track, count: counts[track] }));
}

// --- 2. INITIALIZATION ---
async function init() {
  document.getElementById('c-date').valueAsDate = new Date();
  initCustomCategorySelect();
  initCustomTrackSelect();

  loadState();

  try {
    const res = await fetch('questions.json');
    if (!res.ok) throw new Error('Could not fetch questions.json');
    const data = await res.json();

    const existingIds = new Set(appState.questions.map(q => q.id));
    const newQuestions = [];

    data.forEach(q => {
      enrichQuestionMetadata(q);
      if (!existingIds.has(q.id)) {
        newQuestions.push(q);
        appState.settings.activeQuestions[q.id] = true;
      } else {
        const existingQ = appState.questions.find(x => x.id === q.id);
        Object.assign(existingQ, q);
        enrichQuestionMetadata(existingQ);
      }
    });

    if (newQuestions.length > 0) {
      appState.questions.push(...newQuestions);
    }
    saveState();
  } catch (err) {
    console.warn('Fetch blocked or failed. Using LocalStorage fallback.', err);
    if (appState.questions.length === 0) {
      showToast('Error loading questions. Ensure you are running a local server.');
      document.getElementById('question-list').innerHTML = '<div class="empty-state">Error loading questions.json. If opening directly from file://, fetch might be blocked by CORS. Please run a local server or use GitHub Pages.</div>';
      return;
    }
  }

  appState.questions.forEach(enrichQuestionMetadata);

  populateSetupFields();
  updateSidebarProgress();

  if (appState.candidate.name || Object.keys(appState.session.asked).length > 0) {
    showToast('Resumed previous session');
    navTo('view-bank');
  }
}

// --- 3. STATE MANAGEMENT ---
function saveState() {
  appState.session.overallNote = document.getElementById('overall-notes').value;
  localStorage.setItem('qa_interview_state', JSON.stringify(appState));
  updateSidebarProgress();
}

function loadState() {
  const saved = localStorage.getItem('qa_interview_state');
  if (saved) {
    appState = JSON.parse(saved);
    if (!appState.session) appState.session = { scores: {}, notes: {}, asked: {}, overallNote: '' };
    if (!appState.settings) appState.settings = { activeQuestions: {} };
  }
}

function clearSession() {
  if (confirm('Are you sure you want to end this interview and start fresh? All current scores will be lost.')) {
    appState.candidate = { name: '', exp: '', pos: '', date: new Date().toISOString().split('T')[0], interviewer: '', round: 'Round 1' };
    appState.session = { scores: {}, notes: {}, asked: {}, overallNote: '' };
    saveState();
    populateSetupFields();
    navTo('view-setup');
    showToast('Session cleared');
  }
}

// --- 4. NAVIGATION & UI ---
function navTo(viewId) {
  document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
  document.getElementById(viewId).classList.add('active');

  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  if (document.getElementById('nav-' + viewId.replace('view-', ''))) {
    document.getElementById('nav-' + viewId.replace('view-', '')).classList.add('active');
  }

  if (viewId === 'view-bank') renderBank();
  if (viewId === 'view-scorecard') renderScorecard();
  if (viewId === 'view-settings') renderSettings();
  if (viewId === 'view-report') generateReport();

  const sidebar = document.getElementById('sidebar');
  if (sidebar.classList.contains('open')) sidebar.classList.remove('open');

  window.scrollTo(0, 0);
}

function toggleMobileNav() {
  document.getElementById('sidebar').classList.toggle('open');
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.innerText = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}

function updateSidebarProgress() {
  const { candidate, session } = appState;

  document.getElementById('sum-name').innerText = candidate.name || '--';
  document.getElementById('sum-role').innerText = candidate.pos || '--';

  const askedCount = Object.keys(session.asked).length;
  const activeCount = Object.values(appState.settings.activeQuestions).filter(Boolean).length;
  document.getElementById('sum-asked').innerText = `${askedCount}/${activeCount}`;

  const setupDone = candidate.name && candidate.pos;
  document.getElementById('nav-setup').classList.toggle('completed', setupDone);

  const bankDone = askedCount >= 5;
  document.getElementById('nav-bank').classList.toggle('completed', bankDone);
}

// --- 5. SETUP VIEW ---
function populateSetupFields() {
  const c = appState.candidate;
  document.getElementById('c-name').value = c.name;
  document.getElementById('c-exp').value = c.exp;
  document.getElementById('c-pos').value = c.pos;
  if (c.date) document.getElementById('c-date').value = c.date;
  document.getElementById('c-interviewer').value = c.interviewer;
  document.getElementById('c-round').value = c.round || 'Round 1 - Technical';
  document.getElementById('overall-notes').value = appState.session.overallNote || '';
}

function saveSetupAndStart() {
  appState.candidate = {
    name: document.getElementById('c-name').value,
    exp: document.getElementById('c-exp').value,
    pos: document.getElementById('c-pos').value,
    date: document.getElementById('c-date').value,
    interviewer: document.getElementById('c-interviewer').value,
    round: document.getElementById('c-round').value
  };
  saveState();
  navTo('view-bank');
}

// --- 6. BANK VIEW ---
function renderBank() {
  renderTrackFilter();
  renderTabs();
  renderQuestions();
  updateBankStats();
}

function renderTrackFilter() {
  const select = document.getElementById('track-filter');
  if (!select) return;

  const tracks = getAvailableTracks();
  let html = '<option value="all">ALL TRACKS</option>';
  tracks.forEach(track => {
    html += `<option value="${track.id}">${getTrackLabel(track.id).toUpperCase()} (${track.count})</option>`;
  });

  select.innerHTML = html;
  if (currentTrackFilter !== 'all' && !tracks.some(t => t.id === currentTrackFilter)) {
    currentTrackFilter = 'all';
  }
  select.value = currentTrackFilter;
}

function renderTabs() {
  const tabsContainer = document.getElementById('category-tabs');
  let html = `<div class="cat-tab ${currentCategoryFilter === 'all' ? 'active' : ''}" onclick="setFilter('all')">ALL</div>`;

  getSortedCategories().forEach(cat => {
    const count = appState.questions.filter(q => q.category === cat.id && appState.settings.activeQuestions[q.id]).length;
    html += `<div class="cat-tab ${currentCategoryFilter === cat.id ? 'active' : ''}" onclick="setFilter('${cat.id}')">${cat.label.toUpperCase()} (${count})</div>`;
  });
  tabsContainer.innerHTML = html;
}

function setFilter(catId) {
  currentCategoryFilter = catId;
  currentTrackFilter = 'all';
  currentPage = 1;
  renderBank();
}

function setTrackFilter(trackId) {
  currentTrackFilter = trackId;
  currentCategoryFilter = 'all';
  currentPage = 1;
  renderBank();
}

function getBaseFilteredQuestions() {
  let filtered = appState.questions.filter(q => appState.settings.activeQuestions[q.id]);
  if (currentCategoryFilter !== 'all') {
    filtered = filtered.filter(q => q.category === currentCategoryFilter);
  }
  if (currentTrackFilter !== 'all') {
    filtered = filtered.filter(q => (q.primaryTrack || mapCategoryToTrack(q.category)) === currentTrackFilter);
  }
  return filtered;
}

function setManualSection(sectionNum) {
  currentPage = Number(sectionNum) || 1;
  renderQuestions();
}

function goToPage(nextPage) {
  currentPage = nextPage;
  renderQuestions();
}

function renderBankSubcontrols(totalCount, startIndex, endIndex, totalPages) {
  const container = document.getElementById('bank-subcontrols');
  const pager = document.getElementById('pagination-row');
  if (!container || !pager) return;

  if (totalCount === 0) {
    container.innerHTML = '';
    pager.innerHTML = '';
    return;
  }

  const hasMultipleSections = totalPages > 1;
  let controlsHtml = `<div class="result-window">Showing ${startIndex}-${endIndex} of ${totalCount}</div>`;

  if (currentCategoryFilter === 'manual' && hasMultipleSections) {
    let optionsHtml = '';
    for (let i = 1; i <= totalPages; i++) {
      const start = ((i - 1) * QUESTIONS_PER_SECTION) + 1;
      const end = Math.min(i * QUESTIONS_PER_SECTION, totalCount);
      optionsHtml += `<option value="${i}" ${currentPage === i ? 'selected' : ''}>Section ${i} (${start}-${end})</option>`;
    }

    controlsHtml = `
      <div class="manual-section-picker">
        <label for="manual-section-select">Manual Section</label>
        <select id="manual-section-select" onchange="setManualSection(this.value)">
          ${optionsHtml}
        </select>
      </div>
      <div class="result-window">Showing ${startIndex}-${endIndex} of ${totalCount}</div>
    `;
  }

  container.innerHTML = controlsHtml;

  if (!hasMultipleSections) {
    pager.innerHTML = '';
    return;
  }

  pager.innerHTML = `
    <button class="pager-btn" onclick="goToPage(${currentPage - 1})" ${currentPage <= 1 ? 'disabled' : ''}>Prev</button>
    <span class="pager-state">Page ${currentPage} / ${totalPages}</span>
    <button class="pager-btn" onclick="goToPage(${currentPage + 1})" ${currentPage >= totalPages ? 'disabled' : ''}>Next</button>
  `;
}

function renderQuestions() {
  const container = document.getElementById('question-list');

  const filtered = getBaseFilteredQuestions();
  const totalPages = Math.max(1, Math.ceil(filtered.length / QUESTIONS_PER_SECTION));
  if (currentPage > totalPages) currentPage = totalPages;
  if (currentPage < 1) currentPage = 1;

  const startIndex = ((currentPage - 1) * QUESTIONS_PER_SECTION) + 1;
  const endIndex = Math.min(currentPage * QUESTIONS_PER_SECTION, filtered.length);
  const pagedQuestions = filtered.slice(startIndex - 1, endIndex);

  renderBankSubcontrols(filtered.length, filtered.length ? startIndex : 0, filtered.length ? endIndex : 0, totalPages);

  if (filtered.length === 0) {
    container.innerHTML = '<div class="empty-state">No active questions in this category.</div>';
    return;
  }

  let html = '';
  pagedQuestions.forEach(q => {
    const isAsked = appState.session.asked[q.id];
    const score = appState.session.scores[q.id];
    const note = appState.session.notes[q.id] || '';
    const catLabel = CATEGORIES.find(c => c.id === q.category)?.label || q.category;
    const trackLabel = getTrackLabel(q.primaryTrack || mapCategoryToTrack(q.category));

    html += `
      <div class="q-card ${isAsked ? 'asked' : ''}" id="card-${q.id}" tabindex="0" onkeydown="handleKey(event, '${q.id}')">
        <div class="q-meta">
          <span>${catLabel.toUpperCase()}</span>
          <span>
            <span class="badge">${trackLabel}</span>
            <span class="badge">${q.difficulty}</span>
          </span>
        </div>
        <div class="q-text">${q.question}</div>

        <div class="toggle-answer" onclick="toggleAnswer('${q.id}')">▶ Show answer guide</div>
        <div class="answer-guide" id="guide-${q.id}">
          <div class="guide-item">${q.answerGuide}</div>
          <div class="guide-item green">✔ ${q.greenFlag}</div>
          <div class="guide-item red">✖ ${q.redFlag}</div>
          <div class="guide-item followup">Follow-up: ${q.followUp}</div>
        </div>

        <div class="rating-row">
          <label class="ask-checkbox">
            <input type="checkbox" ${isAsked ? 'checked' : ''} onchange="toggleAsked('${q.id}', this.checked)">
            Question Asked
          </label>

          <div style="flex:1"></div>

          <button class="rating-btn ${score === 1 ? 'selected' : ''}" onclick="rate('${q.id}', 1)" title="Poor">1 - Poor</button>
          <button class="rating-btn ${score === 2 ? 'selected' : ''}" onclick="rate('${q.id}', 2)" title="Below Avg">2</button>
          <button class="rating-btn ${score === 3 ? 'selected' : ''}" onclick="rate('${q.id}', 3)" title="Average">3 - Avg</button>
          <button class="rating-btn ${score === 4 ? 'selected' : ''}" onclick="rate('${q.id}', 4)" title="Good">4</button>
          <button class="rating-btn ${score === 5 ? 'selected' : ''}" onclick="rate('${q.id}', 5)" title="Excellent">5 - Exc</button>
        </div>

        <textarea placeholder="Notes for this specific question..." rows="1"
          onblur="saveNote('${q.id}', this.value)"
          style="width: 100%; font-size: 13px; background: transparent;">${note}</textarea>
      </div>
    `;
  });

  container.innerHTML = html;
}

function toggleAnswer(id) {
  const guide = document.getElementById(`guide-${id}`);
  const btn = guide.previousElementSibling;
  if (guide.classList.contains('show')) {
    guide.classList.remove('show');
    btn.innerText = '▶ Show answer guide';
  } else {
    guide.classList.add('show');
    btn.innerText = '▼ Hide answer guide';
  }
}

function toggleAsked(id, checked) {
  if (checked) {
    appState.session.asked[id] = true;
  } else {
    delete appState.session.asked[id];
    delete appState.session.scores[id];
  }
  saveState();
  renderBank();
}

function rate(id, score) {
  appState.session.asked[id] = true;
  appState.session.scores[id] = score;
  saveState();
  renderBank();
}

function saveNote(id, text) {
  if (text.trim() === '') {
    delete appState.session.notes[id];
  } else {
    appState.session.notes[id] = text;
  }
  saveState();
}

function handleKey(e, id) {
  if (e.key >= '1' && e.key <= '5') {
    rate(id, parseInt(e.key, 10));
  }
}

function updateBankStats() {
  const asked = Object.keys(appState.session.asked).length;
  const total = Object.values(appState.settings.activeQuestions).filter(Boolean).length;

  let sum = 0;
  let ratedCount = 0;
  Object.keys(appState.session.asked).forEach(id => {
    if (appState.session.scores[id]) {
      sum += appState.session.scores[id];
      ratedCount++;
    }
  });

  const avg = ratedCount > 0 ? (sum / ratedCount).toFixed(1) : '0.0';

  document.getElementById('stat-asked').innerText = asked;
  document.getElementById('stat-total').innerText = total;
  document.getElementById('stat-avg').innerText = avg;
}

// --- 7. SCORECARD VIEW ---
function getCategoryStats() {
  const stats = {};
  CATEGORIES.forEach(c => {
    stats[c.id] = { asked: 0, totalScore: 0, ratedCount: 0, activeCount: 0 };
  });

  appState.questions.forEach(q => {
    if (appState.settings.activeQuestions[q.id]) {
      if (stats[q.category]) stats[q.category].activeCount++;
    }
  });

  Object.keys(appState.session.asked).forEach(id => {
    const q = appState.questions.find(question => question.id === id);
    if (q && stats[q.category]) {
      stats[q.category].asked++;
      if (appState.session.scores[id]) {
        stats[q.category].totalScore += appState.session.scores[id];
        stats[q.category].ratedCount++;
      }
    }
  });
  return stats;
}

function getVerdict(pct) {
  if (pct >= 75) return { text: 'Strong Hire — Recommend to proceed', cls: 'verdict-strong' };
  if (pct >= 55) return { text: 'Conditional — Proceed with caution', cls: 'verdict-cond' };
  return { text: 'Do Not Proceed — Not recommended', cls: 'verdict-no' };
}

function getColorClass(val, max) {
  const ratio = val / max;
  if (ratio >= 0.8) return 'color-green';
  if (ratio >= 0.5) return 'color-amber';
  return 'color-red';
}

function getBgClass(val, max) {
  const ratio = val / max;
  if (ratio >= 0.8) return 'bg-green';
  if (ratio >= 0.5) return 'bg-amber';
  return 'bg-red';
}

function renderScorecard() {
  const stats = getCategoryStats();
  const container = document.getElementById('scorecard-grid');
  let html = '';

  let totalPts = 0;
  let totalPoss = 0;

  const chartLabels = [];
  const chartData = [];

  CATEGORIES.forEach(c => {
    const s = stats[c.id];
    const avg = s.ratedCount > 0 ? (s.totalScore / s.ratedCount) : 0;
    const pct = (avg / 5) * 100;

    totalPts += s.totalScore;
    totalPoss += (s.ratedCount * 5);

    chartLabels.push(c.label);
    chartData.push(avg);

    html += `
      <div class="score-row">
        <div class="score-cat-name">${c.label}</div>
        <div class="score-asked">${s.asked}/${s.activeCount} asked</div>
        <div class="score-bar-container">
          <div class="score-bar ${getBgClass(avg, 5)}" style="width: ${pct}%"></div>
        </div>
        <div class="score-val ${getColorClass(avg, 5)}">${avg.toFixed(1)}</div>
      </div>
    `;
  });
  container.innerHTML = html;

  const overallPct = totalPoss > 0 ? Math.round((totalPts / totalPoss) * 100) : 0;
  document.getElementById('sc-overall-pct').innerText = `${overallPct}%`;
  document.getElementById('sc-points-detail').innerText = `${totalPts} / ${totalPoss} points`;

  const v = getVerdict(overallPct);
  const verdictEl = document.getElementById('sc-verdict');
  verdictEl.innerText = v.text;
  verdictEl.className = `overall-verdict ${v.cls}`;

  if (window.Chart) {
    document.getElementById('chart-container').style.display = 'block';
    const ctx = document.getElementById('radarChart').getContext('2d');
    if (chartInstance) chartInstance.destroy();

    chartInstance = new Chart(ctx, {
      type: 'radar',
      data: {
        labels: chartLabels,
        datasets: [{
          label: 'Category Score',
          data: chartData,
          backgroundColor: 'rgba(37, 99, 235, 0.2)',
          borderColor: 'rgba(37, 99, 235, 1)',
          pointBackgroundColor: 'rgba(37, 99, 235, 1)',
          borderWidth: 2
        }]
      },
      options: {
        scales: {
          r: { min: 0, max: 5, ticks: { stepSize: 1 } }
        },
        plugins: { legend: { display: false } }
      }
    });
  }
}

// --- 8. REPORT GENERATION ---
function getRatingWord(avg) {
  if (avg >= 4) return 'Strong';
  if (avg >= 3) return 'Good';
  if (avg >= 2) return 'Average';
  if (avg > 0) return 'Poor';
  return 'N/A';
}

function getSummaryLine(catLabel, avg) {
  if (avg >= 4) return `${catLabel} (${avg.toFixed(1)}/5): Strong performance. Candidate showed depth and practical experience.`;
  if (avg >= 3) return `${catLabel} (${avg.toFixed(1)}/5): Adequate understanding. Some gaps noted but acceptable for this level.`;
  if (avg > 0) return `${catLabel} (${avg.toFixed(1)}/5): Weak area. Significant gaps identified — further assessment recommended.`;
  return '';
}

function generateReportHTML() {
  appState.session.overallNote = document.getElementById('overall-notes').value;
  saveState();

  const c = appState.candidate;
  const stats = getCategoryStats();
  let totalPts = 0;
  let totalPoss = 0;

  let html = `
    <div class="report-header">
      <h1>QA Engineer Interview Assessment Report</h1>
      <div class="report-meta-grid">
        <div><strong>Candidate:</strong> ${c.name || 'N/A'}</div>
        <div><strong>Date:</strong> ${c.date}</div>
        <div><strong>Position:</strong> ${c.pos}</div>
        <div><strong>Interviewer:</strong> ${c.interviewer}</div>
        <div><strong>Experience:</strong> ${c.exp} years</div>
        <div><strong>Round:</strong> ${c.round}</div>
      </div>
    </div>

    <div class="report-section">
      <h3>Score Summary</h3>
      <table class="report-table">
        <thead>
          <tr><th>Category</th><th>Asked</th><th>Score</th><th>Rating</th></tr>
        </thead>
        <tbody>
  `;

  let obsHtml = '';
  CATEGORIES.forEach(cat => {
    const s = stats[cat.id];
    if (s.asked > 0) {
      const avg = s.ratedCount > 0 ? (s.totalScore / s.ratedCount) : 0;
      totalPts += s.totalScore;
      totalPoss += (s.ratedCount * 5);
      html += `<tr>
        <td>${cat.label}</td>
        <td>${s.asked}/${s.activeCount}</td>
        <td>${avg.toFixed(1)}/5</td>
        <td>${getRatingWord(avg)}</td>
      </tr>`;

      if (s.ratedCount > 0) {
        obsHtml += `<p style="margin-bottom:8px">• ${getSummaryLine(cat.label, avg)}</p>`;
      }
    }
  });

  const overallPct = totalPoss > 0 ? Math.round((totalPts / totalPoss) * 100) : 0;
  const v = getVerdict(overallPct);

  html += `
        </tbody>
        <tfoot>
          <tr style="font-weight:bold; background:#eee;">
            <td>OVERALL</td>
            <td>--</td>
            <td>${overallPct}%</td>
            <td>${v.text.split('—')[0].trim()}</td>
          </tr>
        </tfoot>
      </table>
    </div>

    <div class="report-section">
      <h3>Category Highlights</h3>
      ${obsHtml || '<p>No questions answered.</p>'}
    </div>

    <div class="report-section">
      <h3>Question-Level Detail</h3>
  `;

  appState.questions.forEach(q => {
    if (appState.session.asked[q.id]) {
      const score = appState.session.scores[q.id] || 'N/A';
      const note = appState.session.notes[q.id];
      html += `
        <div class="q-detail-item">
          <div><strong>Q: ${q.question}</strong> (Score: ${score})</div>
          ${note ? `<div style="margin-top:4px; font-style:italic; color:#555;">Note: ${note}</div>` : ''}
        </div>
      `;
    }
  });

  html += `
    </div>
    <div class="report-section">
      <h3>Overall Notes</h3>
      <p style="white-space: pre-wrap;">${appState.session.overallNote || 'None.'}</p>
    </div>

    <div class="report-section" style="text-align:center; padding: 20px; border: 2px solid #333; margin-top:40px;">
      <h2 style="margin-bottom:10px;">FINAL RECOMMENDATION</h2>
      <h3 style="font-size:20px;">${v.text.toUpperCase()}</h3>
      <p style="margin-top:10px; color:#555;">Interviewed by: ${c.interviewer || 'N/A'} on ${c.date}</p>
    </div>
  `;

  document.getElementById('report-paper').innerHTML = html;
}

function generateReport() {
  generateReportHTML();
}

function getTrackStats() {
  const stats = {};
  Object.keys(appState.session.asked).forEach(id => {
    const q = appState.questions.find(x => x.id === id);
    if (!q) return;
    const track = q.primaryTrack || mapCategoryToTrack(q.category);
    if (!stats[track]) {
      stats[track] = { asked: 0, totalScore: 0, ratedCount: 0 };
    }
    stats[track].asked++;
    if (appState.session.scores[id]) {
      stats[track].totalScore += appState.session.scores[id];
      stats[track].ratedCount++;
    }
  });
  return stats;
}

function buildScoreSummaryText() {
  const c = appState.candidate;
  const catStats = getCategoryStats();
  const trackStats = getTrackStats();
  let totalPts = 0;
  let totalPoss = 0;

  CATEGORIES.forEach(cat => {
    const s = catStats[cat.id];
    totalPts += s.totalScore;
    totalPoss += (s.ratedCount * 5);
  });

  const overallPct = totalPoss > 0 ? Math.round((totalPts / totalPoss) * 100) : 0;
  const verdict = getVerdict(overallPct).text;

  const categorySummary = CATEGORIES.map(cat => {
    const s = catStats[cat.id];
    const avg = s.ratedCount > 0 ? Number((s.totalScore / s.ratedCount).toFixed(2)) : 0;
    return {
      categoryId: cat.id,
      categoryLabel: cat.label,
      asked: s.asked,
      active: s.activeCount,
      average: avg
    };
  });

  const trackSummary = Object.keys(trackStats).sort().map(trackId => {
    const s = trackStats[trackId];
    const avg = s.ratedCount > 0 ? Number((s.totalScore / s.ratedCount).toFixed(2)) : 0;
    return {
      trackId,
      trackLabel: getTrackLabel(trackId),
      asked: s.asked,
      average: avg
    };
  });

  const payload = {
    candidate: {
      name: c.name || '',
      position: c.pos || '',
      experienceYears: c.exp || '',
      date: c.date || '',
      interviewer: c.interviewer || '',
      round: c.round || ''
    },
    summary: {
      overallPercent: overallPct,
      totalPoints: totalPts,
      maxPoints: totalPoss,
      verdict
    },
    byCategory: categorySummary,
    byTrack: trackSummary
  };

  return JSON.stringify(payload, null, 2);
}

function downloadScoreSummaryText() {
  const text = buildScoreSummaryText();
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const safeName = (appState.candidate.name || 'candidate').replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '');
  const fileName = `score_summary_${safeName || 'candidate'}.txt`;

  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Score summary TXT downloaded');
}

// --- 9. SETTINGS ---
function renderSettings() {
  renderSettingsCategoryFilter();
  const list = document.getElementById('settings-q-list');
  const stats = document.getElementById('settings-stats');
  const toggleBtn = document.getElementById('settings-custom-toggle');

  const visible = getSettingsFilteredQuestions();
  const visibleActive = visible.filter(q => appState.settings.activeQuestions[q.id]).length;
  toggleBtn.innerText = `Custom Only: ${settingsCustomOnly ? 'On' : 'Off'}`;
  stats.innerHTML = `
    <span>Visible: ${visible.length}</span>
    <span>Active: ${visibleActive}</span>
    <span>Total Questions: ${appState.questions.length}</span>
  `;

  if (!visible.length) {
    list.innerHTML = '<div class="empty-state">No questions match current filters.</div>';
    return;
  }

  const groups = {};
  visible.forEach(q => {
    const key = q.category || 'uncategorized';
    if (!groups[key]) groups[key] = [];
    groups[key].push(q);
  });

  const sortedCategories = Object.keys(groups).sort((a, b) => getCategoryLabel(a).localeCompare(getCategoryLabel(b)));
  let html = '';
  sortedCategories.forEach(catId => {
    const items = groups[catId].sort((a, b) => String(a.question).localeCompare(String(b.question)));
    html += '<div class="settings-category-block">';
    html += `<div class="settings-category-title">${getCategoryLabel(catId)} (${items.length})</div>`;
    items.forEach(q => {
      const active = appState.settings.activeQuestions[q.id];
      const track = getTrackLabel(q.primaryTrack || mapCategoryToTrack(q.category));
      html += `
        <div class="settings-q-item">
          <label class="settings-q-label">
            <input type="checkbox" ${active ? 'checked' : ''} onchange="toggleQActive('${q.id}', this.checked)">
            <span>
              <div>${q.question}</div>
              <div class="settings-q-meta">${q.id} • ${track}</div>
            </span>
          </label>
          ${q.custom ? `<span class="settings-delete" onclick="deleteQ('${q.id}')">Delete</span>` : '<span class="settings-lock">Locked</span>'}
        </div>
      `;
    });
    html += '</div>';
  });

  list.innerHTML = html;
}

function getCategoryLabel(catId) {
  return CATEGORIES.find(c => c.id === catId)?.label || catId;
}

function renderSettingsCategoryFilter() {
  const select = document.getElementById('settings-cat-filter');
  if (!select) return;

  const ids = Array.from(new Set(appState.questions.map(q => q.category).filter(Boolean)))
    .sort((a, b) => getCategoryLabel(a).localeCompare(getCategoryLabel(b)));

  let html = '<option value="all">All Categories</option>';
  ids.forEach(id => {
    html += `<option value="${id}">${getCategoryLabel(id)}</option>`;
  });

  select.innerHTML = html;
  if (settingsCategoryFilter !== 'all' && !ids.includes(settingsCategoryFilter)) {
    settingsCategoryFilter = 'all';
  }
  select.value = settingsCategoryFilter;
}

function getSettingsFilteredQuestions() {
  return appState.questions.filter(q => {
    if (settingsCategoryFilter !== 'all' && q.category !== settingsCategoryFilter) return false;
    if (settingsCustomOnly && !q.custom) return false;
    if (settingsSearchTerm) {
      const haystack = `${q.question || ''} ${q.id || ''} ${q.category || ''}`.toLowerCase();
      if (!haystack.includes(settingsSearchTerm)) return false;
    }
    return true;
  });
}

function setSettingsSearch(value) {
  settingsSearchTerm = (value || '').trim().toLowerCase();
  renderSettings();
}

function setSettingsCategoryFilter(value) {
  settingsCategoryFilter = value || 'all';
  renderSettings();
}

function toggleSettingsCustomOnly() {
  settingsCustomOnly = !settingsCustomOnly;
  renderSettings();
}

function setAllVisibleQuestionsActive(state) {
  const visible = getSettingsFilteredQuestions();
  visible.forEach(q => {
    appState.settings.activeQuestions[q.id] = state;
  });
  saveState();
  renderSettings();
  showToast(`${state ? 'Enabled' : 'Disabled'} ${visible.length} visible question(s)`);
}

function toggleQActive(id, state) {
  appState.settings.activeQuestions[id] = state;
  saveState();
  updateSidebarProgress();
}

function deleteQ(id) {
  if (confirm('Delete this custom question?')) {
    appState.questions = appState.questions.filter(q => q.id !== id);
    delete appState.settings.activeQuestions[id];
    saveState();
    renderSettings();
  }
}

function addCustomQuestion() {
  const cat = document.getElementById('custom-cat').value;
  const track = document.getElementById('custom-track').value || mapCategoryToTrack(cat);
  const q = document.getElementById('custom-q').value;
  const ans = document.getElementById('custom-ans').value;
  const green = document.getElementById('custom-green').value;
  const red = document.getElementById('custom-red').value;

  if (!q) {
    showToast('Question text is required');
    return;
  }

  const id = 'cq_' + Date.now();
  appState.questions.push({
    id,
    category: cat,
    difficulty: 'Medium',
    question: q,
    answerGuide: ans,
    greenFlag: green,
    redFlag: red,
    followUp: '',
    custom: true,
    primaryTrack: track,
    tags: [cat, track]
  });
  appState.settings.activeQuestions[id] = true;
  saveState();

  document.getElementById('custom-q').value = '';
  document.getElementById('custom-ans').value = '';
  document.getElementById('custom-green').value = '';
  document.getElementById('custom-red').value = '';

  showToast('Custom question added!');
  renderSettings();
}

function exportQuestions() {
  const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(appState.questions, null, 2));
  const dlAnchorElem = document.createElement('a');
  dlAnchorElem.setAttribute('href', dataStr);
  dlAnchorElem.setAttribute('download', 'questions.json');
  dlAnchorElem.click();
}

function importQuestions(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function onLoad(event) {
    try {
      const contents = JSON.parse(event.target.result);
      if (Array.isArray(contents)) {
        appState.questions = contents.map(enrichQuestionMetadata);
        contents.forEach(q => {
          if (appState.settings.activeQuestions[q.id] === undefined) {
            appState.settings.activeQuestions[q.id] = true;
          }
        });
        saveState();
        renderSettings();
        showToast('Questions imported successfully!');
      }
    } catch (err) {
      showToast('Invalid JSON file');
    }
  };
  reader.readAsText(file);
}

function initCustomTrackSelect() {
  const select = document.getElementById('custom-track');
  if (!select) return;
  const keys = Object.keys(TRACK_LABELS).sort((a, b) => TRACK_LABELS[a].localeCompare(TRACK_LABELS[b]));
  select.innerHTML = keys.map(k => `<option value="${k}">${TRACK_LABELS[k]}</option>`).join('');
}

function initCustomCategorySelect() {
  const select = document.getElementById('custom-cat');
  if (!select) return;
  const sortedCategories = getSortedCategories();
  select.innerHTML = sortedCategories
    .map(cat => `<option value="${cat.id}">${cat.label}</option>`)
    .join('');
}

window.onload = init;