export function createQualityPanel({ qualities, codecs, audios, initial, onChange }) {
  const root = document.createElement('div');
  root.className = 'brx-quality-panel';
  root.innerHTML = '<label>清晰度 <select data-k="qn"></select></label><label>编码 <select data-k="codec"></select></label><label>音轨 <select data-k="audioId"></select></label>';
  fill(root.querySelector('[data-k="qn"]'), [{ id: 'auto', label: '自动清晰度' }, ...qualities], initial.qn || 'auto');
  fill(root.querySelector('[data-k="codec"]'), codecs, initial.codec || 'auto');
  fill(root.querySelector('[data-k="audioId"]'), audios, initial.audioId || 'auto');
  root.addEventListener('change', () => onChange(read(root)));
  root.__brxSetSelection = (selection) => {
    for (const [key, value] of Object.entries(selection || {})) {
      const el = root.querySelector(`[data-k="${key}"]`);
      if (el && [...el.options].some((o) => o.value === String(value))) el.value = String(value);
    }
  };
  return root;
}
function read(root) {
  return {
    qn: root.querySelector('[data-k="qn"]').value,
    codec: root.querySelector('[data-k="codec"]').value,
    audioId: root.querySelector('[data-k="audioId"]').value,
  };
}
function fill(sel, items, value) {
  sel.innerHTML = '';
  for (const it of items) {
    const o = document.createElement('option');
    o.value = it.id;
    o.textContent = it.label;
    sel.appendChild(o);
  }
  sel.value = value;
}
