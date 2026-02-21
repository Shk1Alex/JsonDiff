const leftTA = document.getElementById('left');
const rightTA = document.getElementById('right');
const leftErr = document.getElementById('leftErr');
const rightErr = document.getElementById('rightErr');

const diffBox = document.getElementById('diffBox');
const diffHeaderText = document.getElementById('diffHeaderText');
const diffHeaderNote = document.getElementById('diffHeaderNote');
const diffLeft = document.getElementById('diffLeft');
const diffRight = document.getElementById('diffRight');

const modeSwitch = document.getElementById('modeSwitch');
const modeLabel = document.getElementById('modeLabel');

const pathsBox = document.getElementById('pathsBox');
const pathsTbody = document.getElementById('pathsTbody');

//  UI actions 
document.getElementById('formatBtn').addEventListener('click', () => {
  formatBoth({ stableKeys: true });
});

document.getElementById('diffBtn').addEventListener('click', () => {
  formatBoth({ stableKeys: true });
  doDiff();
});

document.getElementById('clearBtn').addEventListener('click', () => {
  leftTA.value = '';
  rightTA.value = '';
  leftErr.textContent = '';
  rightErr.textContent = '';
  diffBox.style.display = 'none';
  diffLeft.innerHTML = '';
  diffRight.innerHTML = '';
  pathsTbody.innerHTML = '';
});

modeSwitch.addEventListener('change', () => {
  updateModeLabel();
  if (diffBox.style.display !== 'none') doDiff();
});

updateModeLabel();

function updateModeLabel() {
  modeLabel.textContent = modeSwitch.checked
    ? 'Mode: Key/Path diff'
    : 'Mode: Prettier lines';
}

//  Parsing / formatting 
function safeParse(text) {
  const cleaned = text.replace(/^\uFEFF/, '').trim();
  if (!cleaned) return { ok: true, value: null, empty: true };
  try {
    return { ok: true, value: JSON.parse(cleaned), empty: false };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value).sort()) out[k] = sortKeysDeep(value[k]);
    return out;
  }
  return value;
}

function pretty(value, { stableKeys }) {
  const v = stableKeys ? sortKeysDeep(value) : value;
  return JSON.stringify(v, null, 2);
}

function formatBoth({ stableKeys = true } = {}) {
  leftErr.textContent = '';
  rightErr.textContent = '';

  const parsedLeft = safeParse(leftTA.value);
  const parsedRight = safeParse(rightTA.value);

  if (!parsedLeft.ok) leftErr.textContent = parsedLeft.error;
  if (!parsedRight.ok) rightErr.textContent = parsedRight.error;

  if (parsedLeft.ok && !parsedLeft.empty) leftTA.value = pretty(parsedLeft.value, { stableKeys });
  if (parsedRight.ok && !parsedRight.empty) rightTA.value = pretty(parsedRight.value, { stableKeys });
}

//  Helpers: key/value highlight 
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

// "key": value -> { indent, key, sep, rest }
function splitKeyValue(line) {
  const m = (line ?? '').match(/^(\s*)"([^"]+)"(\s*:\s*)(.*)$/);
  if (!m) return null;
  return { indent: m[1], key: m[2], sep: m[3], rest: m[4] };
}

function renderLines(container, leftLines, rightLines, marksLeft, marksRight, side /* 'L'|'R' */) {
  container.innerHTML = '';

  const lines = side === 'L' ? leftLines : rightLines;
  const marks = side === 'L' ? marksLeft : marksRight;

  for (let i = 0; i < lines.length; i++) {
    const row = document.createElement('div');
    row.className = 'line';

    const ln = document.createElement('div');
    ln.className = 'ln';
    ln.textContent = String(i + 1);

    const txt = document.createElement('div');

    const mark = marks[i] || { type: 'none' };

    if (mark.type === 'match') row.classList.add('goodLine');
    if (mark.type === 'mismatch') row.classList.add('badMismatch');

    if (mark.type === 'diffValue') {
      const parsed = splitKeyValue(lines[i] ?? '');
      if (parsed) {
        txt.innerHTML =
          escapeHtml(parsed.indent) +
          `<span class="kGood">"${escapeHtml(parsed.key)}"</span>` +
          escapeHtml(parsed.sep) +
          `<span class="vWarn">${escapeHtml(parsed.rest)}</span>`;
      } else {
        row.classList.add('badMismatch');
        txt.textContent = lines[i] ?? '';
      }
    } else {
      txt.textContent = lines[i] ?? '';
    }

    row.appendChild(ln);
    row.appendChild(txt);
    container.appendChild(row);
  }
}

//  Line-mode (строковый) 
function buildLineMarks_byIndex(leftLines, rightLines) {
  const max = Math.max(leftLines.length, rightLines.length);
  const left = leftLines.slice();
  const right = rightLines.slice();
  while (left.length < max) left.push('');
  while (right.length < max) right.push('');

  const marksLeft = Array(max).fill(null);
  const marksRight = Array(max).fill(null);

  for (let i = 0; i < max; i++) {
    const l = left[i];
    const r = right[i];

    if (l === r) {
      marksLeft[i] = { type: 'match' };
      marksRight[i] = { type: 'match' };
      continue;
    }

    if (l === '' || r === '') {
      marksLeft[i] = { type: 'mismatch' };
      marksRight[i] = { type: 'mismatch' };
      continue;
    }

    const lp = splitKeyValue(l);
    const rp = splitKeyValue(r);

    if (lp && rp) {
      if (lp.key === rp.key) {
        marksLeft[i] = { type: 'diffValue' };
        marksRight[i] = { type: 'diffValue' };
      } else {
        marksLeft[i] = { type: 'mismatch' };
        marksRight[i] = { type: 'mismatch' };
      }
    } else {
      marksLeft[i] = { type: 'mismatch' };
      marksRight[i] = { type: 'mismatch' };
    }
  }

  return { left, right, marksLeft, marksRight };
}

//  Path-mode (по путям) 
function isPrimitive(x) {
  return x === null || (typeof x !== 'object');
}

function valuePreview(v) {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function joinPath(base, seg) {
  if (typeof seg === 'number') return base + `[${seg}]`;
  return base ? base + '.' + seg : seg;
}

function diffByPath(leftVal, rightVal) {
  const diffs = [];

  function walk(a, b, path) {
    if (isPrimitive(a) || isPrimitive(b)) {
      if (a !== b) diffs.push({ path: path || '(root)', left: a, right: b });
      return;
    }

    const aIsArr = Array.isArray(a);
    const bIsArr = Array.isArray(b);

    if (aIsArr || bIsArr) {
      if (!(aIsArr && bIsArr)) {
        diffs.push({ path: path || '(root)', left: a, right: b });
        return;
      }
      const max = Math.max(a.length, b.length);
      for (let i = 0; i < max; i++) {
        if (i >= a.length) diffs.push({ path: joinPath(path, i), left: undefined, right: b[i] });
        else if (i >= b.length) diffs.push({ path: joinPath(path, i), left: a[i], right: undefined });
        else walk(a[i], b[i], joinPath(path, i));
      }
      return;
    }

    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of Array.from(keys).sort()) {
      if (!(k in a)) diffs.push({ path: joinPath(path, k), left: undefined, right: b[k] });
      else if (!(k in b)) diffs.push({ path: joinPath(path, k), left: a[k], right: undefined });
      else walk(a[k], b[k], joinPath(path, k));
    }
  }

  walk(leftVal, rightVal, '');
  return diffs;
}

function renderPathsTable(diffs) {
  pathsTbody.innerHTML = '';
  for (const d of diffs) {
    const tr = document.createElement('tr');

    const tdPath = document.createElement('td');
    tdPath.textContent = d.path;

    const tdL = document.createElement('td');
    tdL.textContent = valuePreview(d.left);

    const tdR = document.createElement('td');
    tdR.textContent = valuePreview(d.right);

    tr.appendChild(tdPath);
    tr.appendChild(tdL);
    tr.appendChild(tdR);
    pathsTbody.appendChild(tr);
  }
}

function buildMarks_fromDiffs(lines, diffs, side /* 'L'|'R' */) {
  // severity: mismatch > diffValue
  const keyToType = new Map();

  for (const d of diffs) {
    const p = d.path;
    if (!p || p === '(root)') continue;

    if (/\[\d+\]$/.test(p)) continue;

    const last = p.split('.').pop() || '';
    if (!last) continue;
    if (/\[\d+\]/.test(last)) continue; 

    // missing?
    const isMissingLeft = (d.left === undefined);
    const isMissingRight = (d.right === undefined);

    let type = null;
    if (isMissingLeft || isMissingRight) {
      if ((side === 'L' && isMissingLeft) || (side === 'R' && isMissingRight)) {
        type = null; 
      } else {
        type = 'mismatch';
      }
    } else {
      type = 'diffValue';
    }

    if (!type) continue;

    const prev = keyToType.get(last);
    if (prev === 'mismatch') continue;
    if (type === 'mismatch') keyToType.set(last, 'mismatch');
    else if (!prev) keyToType.set(last, 'diffValue');
  }

  const marks = Array(lines.length).fill(null);

  for (let i = 0; i < lines.length; i++) {
    const parsed = splitKeyValue(lines[i]);
    if (!parsed) continue;

    const type = keyToType.get(parsed.key);
    if (!type) continue;

    marks[i] = { type };
  }

  return marks;
}

// - Main diff runner 
function doDiff() {
  leftErr.textContent = '';
  rightErr.textContent = '';

  const parsedLeft = safeParse(leftTA.value);
  const parsedRight = safeParse(rightTA.value);

  if (!parsedLeft.ok) { leftErr.textContent = parsedLeft.error; hideDiff(); return; }
  if (!parsedRight.ok) { rightErr.textContent = parsedRight.error; hideDiff(); return; }

  const stableKeys = true;

  const leftText = parsedLeft.empty ? '' : pretty(parsedLeft.value, { stableKeys });
  const rightText = parsedRight.empty ? '' : pretty(parsedRight.value, { stableKeys });

  const isPathMode = modeSwitch.checked;

  showDiff();
  diffHeaderNote.textContent = isPathMode ? 'Path diff (JSON-aware)' : 'Line diff (prettier-style)';

  const leftLines = leftText.split('\n');
  const rightLines = rightText.split('\n');

 
  const max = Math.max(leftLines.length, rightLines.length);
  while (leftLines.length < max) leftLines.push('');
  while (rightLines.length < max) rightLines.push('');

  if (!isPathMode) {
    // LINE MODE
    pathsBox.style.display = 'none';

    const { left: paddedLeft, right: paddedRight, marksLeft, marksRight } =
      buildLineMarks_byIndex(leftLines, rightLines);

    const diffCount = marksRight.filter(m => m && m.type !== 'match').length;
    diffHeaderText.textContent = `Diff: ${diffCount} differing line(s)`;

    renderLines(diffLeft, paddedLeft, paddedRight, marksLeft, marksRight, 'L');
    renderLines(diffRight, paddedLeft, paddedRight, marksLeft, marksRight, 'R');
    return;
  }

  // PATH MODE
  pathsBox.style.display = 'block';

  const diffs = diffByPath(
    parsedLeft.empty ? null : sortKeysDeep(parsedLeft.value),
    parsedRight.empty ? null : sortKeysDeep(parsedRight.value)
  );

  diffHeaderText.textContent = `Diff: ${diffs.length} differing path(s)`;
  renderPathsTable(diffs);

  const marksLeft = buildMarks_fromDiffs(leftLines, diffs, 'L');
  const marksRight = buildMarks_fromDiffs(rightLines, diffs, 'R');

  renderLines(diffLeft, leftLines, rightLines, marksLeft, marksRight, 'L');
  renderLines(diffRight, leftLines, rightLines, marksLeft, marksRight, 'R');
}

function showDiff() {
  diffBox.style.display = 'block';
}

function hideDiff() {
  diffBox.style.display = 'none';
  diffLeft.innerHTML = '';
  diffRight.innerHTML = '';
  pathsTbody.innerHTML = '';
}