import { labels, colors, taskLabels, layout, accent, strings, forLang } from './foundation.js';
export { labels, colors, taskLabels, forLang };
export const CONTENT_WIDTH = layout.contentWidth;
export const BUTTON_WIDTH = 80;
export const escape = text => String(text).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[character]));
export function date(value) {
  if (!value) return '';
  const d = new Date(value);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
export function svg(body, width, height, preserveAspectRatio = 'none') {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" preserveAspectRatio="${preserveAspectRatio}" viewBox="0 0 ${width} ${height}"><style>:root{color-scheme:light dark;color:light-dark(#252931,#E8EDF2)}text{font-family:system-ui,-apple-system,sans-serif}</style>${body}</svg>`;
}
function charAdvance(ch, fontSize) {
  if (/[^\x00-\xff]/.test(ch)) return fontSize;
  if (ch === ' ') return fontSize <= 14 ? 4 : 6;
  return fontSize >= 20 ? 12 : 7;
}
function textWidth(value, fontSize) {
  let width = 0;
  for (const ch of String(value || '')) width += charAdvance(ch, fontSize);
  return width;
}
export function truncateLine(value, maxWidth, fontSize = 13, ellipsis = '...') {
  const raw = String(value || '').replace(/\s+/g, ' ').trim();
  const limit = Number.isFinite(maxWidth) && maxWidth > fontSize ? maxWidth : fontSize;
  if (textWidth(raw, fontSize) <= limit) return raw;
  const suffixWidth = textWidth(ellipsis, fontSize);
  const chars = [...raw];
  let out = '';
  let used = 0;
  for (const ch of chars) {
    const adv = charAdvance(ch, fontSize);
    if (used + adv + suffixWidth > limit) break;
    out += ch;
    used += adv;
  }
  const trimmed = out.trimEnd();
  return (trimmed || chars[0] || '') + ellipsis;
}
export function wrapTitleLines(title, maxWidth = CONTENT_WIDTH - 44) {
  const limit = Math.max(48, Number.isFinite(maxWidth) ? maxWidth : CONTENT_WIDTH - 44);
  const lines = [];
  let rest = String(title || '').trim();
  for (let line = 0; line < 2 && rest; line++) {
    if (line === 1 && textWidth(rest, 24) > limit) {
      lines.push(truncateLine(rest, limit, 24, '...'));
      rest = '';
      break;
    }
    let used = 0, end = 0;
    for (const character of rest) {
      const advance = charAdvance(character, 24);
      if (used + advance > limit) break;
      used += advance; end += character.length;
    }
    if (end === 0 && rest) end = [...rest][0].length;
    if (end < rest.length && /[a-zA-Z]/.test(rest[end - 1] || '') && /[a-zA-Z]/.test(rest[end] || '')) {
      const space = rest.lastIndexOf(' ', end);
      if (space > 0) end = space;
    }
    const text = rest.slice(0, end).trim();
    rest = rest.slice(end).trim();
    lines.push(text);
  }
  return lines;
}
export function headerRing(record, active) {
  const color = colors[record?.state] || colors.unstarted, value = record?.progress;
  const angle = (value || 0) * Math.PI / 50, x = 16 + 10 * Math.sin(angle), y = 17 - 10 * Math.cos(angle);
  const pie = value === 100 ? `<circle cx="16" cy="17" r="10" fill="${color}"/>` : value > 0 ? `<path d="M16 17 L16 7 A10 10 0 ${value > 50 ? 1 : 0} 1 ${x} ${y} Z" fill="${color}"/>` : '';
  return svg(`<style>.number{display:none}.heading:hover .number{display:block}.heading:hover .pie{display:none}@keyframes spin{to{transform:rotate(360deg)}}.loading{transform-origin:16px 17px;animation:spin 1s linear infinite}</style><g class="heading"><circle class="${active ? 'loading' : ''}" cx="16" cy="17" r="14" fill="none" stroke="${color}" stroke-width="2" ${active ? 'stroke-dasharray="53 35"' : ''}/><g class="pie">${active ? '' : pie}</g><text class="number" x="16" y="21" text-anchor="middle" font-size="9" fill="${color}">${value == null ? '—' : value + '%'}</text></g>`, 32, 34, 'xMidYMid meet');
}
export function headerTitleSpec(title, maxWidth = CONTENT_WIDTH - 44) {
  const width = Math.max(48, Math.round(Number.isFinite(maxWidth) ? maxWidth : CONTENT_WIDTH - 44));
  const lines = wrapTitleLines(title, width);
  const height = lines.length > 1 ? 64 : 34;
  return {
    width,
    height,
    source: svg(`<g><title>${escape(title)}</title>${lines.map((line, index) => `<text x="0" y="${25 + index * 31}" font-size="24" font-weight="650" letter-spacing="-.5" fill="currentColor">${escape(line)}</text>`).join('')}</g>`, width, height, 'xMinYMin meet'),
  };
}
export function headerTitle(title, maxWidth = CONTENT_WIDTH - 44) {
  return headerTitleSpec(title, maxWidth).source;
}
export function header(title, record, active, reserve = 0) {
  const color = colors[record?.state] || colors.unstarted, value = record?.progress;
  const angle = (value || 0) * Math.PI / 50, x = 16 + 10 * Math.sin(angle), y = 17 - 10 * Math.cos(angle);
  const pie = value === 100 ? `<circle cx="16" cy="17" r="10" fill="${color}"/>` : value > 0 ? `<path d="M16 17 L16 7 A10 10 0 ${value > 50 ? 1 : 0} 1 ${x} ${y} Z" fill="${color}"/>` : '';
  const lines = wrapTitleLines(title, CONTENT_WIDTH - 44 - reserve);
  return svg(`<style>.number{display:none}.heading:hover .number{display:block}.heading:hover .pie{display:none}@keyframes spin{to{transform:rotate(360deg)}}.loading{transform-origin:16px 17px;animation:spin 1s linear infinite}</style><g class="heading"><title>${escape(title)}</title><circle class="${active ? 'loading' : ''}" cx="16" cy="17" r="14" fill="none" stroke="${color}" stroke-width="2" ${active ? 'stroke-dasharray="53 35"' : ''}/><g class="pie">${active ? '' : pie}</g><text class="number" x="16" y="21" text-anchor="middle" font-size="9" fill="${color}">${value == null ? '—' : value + '%'}</text>${lines.map((line, index) => `<text x="42" y="${25 + index * 31}" font-size="24" font-weight="650" letter-spacing="-.5" fill="currentColor">${escape(line)}</text>`).join('')}</g>`, CONTENT_WIDTH, 64, 'xMinYMin meet');
}
export function statusBadgeSvg(dotColor, label, maxWidth = 150, dotOpacity = 1, labelOpacity = 1) {
  const width = Math.max(56, Math.round(Number.isFinite(maxWidth) ? maxWidth : 150));
  const clipped = truncateLine(label, Math.max(36, width - 17), 13, '...');
  return svg(`<circle cx="5" cy="9" r="4.25" fill="none" stroke="${dotColor}" stroke-width="1.5" opacity="${dotOpacity}"/><text x="17" y="13" font-size="13" fill="currentColor" opacity="${labelOpacity}">${escape(clipped)}</text>`, width, 18, 'xMinYMid meet');
}
export function timeTextSvg(value, maxWidth = 150) {
  const width = Math.max(56, Math.round(Number.isFinite(maxWidth) ? maxWidth : 150));
  const clipped = truncateLine(value, Math.max(36, width - 17), 11, '...');
  return svg(`<text x="17" y="12" font-size="11" fill="currentColor" opacity=".68">${escape(clipped)}</text>`, width, 18, 'xMinYMid meet');
}
export function scoreSvg(progress, opacity = 1) {
  return svg(`<text x="92" y="39" text-anchor="end" fill="currentColor" font-size="39" font-weight="550" letter-spacing="-1" opacity="${opacity}">${progress ?? '—'}<tspan font-size="15" letter-spacing="0" opacity=".6"> %</tspan></text>`, 96, 48, 'xMaxYMid meet');
}
export function bar(value, color, width = CONTENT_WIDTH) {
  const barWidth = Math.max(60, Math.round(Number.isFinite(width) ? width : CONTENT_WIDTH));
  return svg(`<rect width="${barWidth}" height="4" rx="2" fill="${color}" opacity=".15"/><rect width="${barWidth * (value || 0) / 100}" height="4" rx="2" fill="${color}"/>`, barWidth, 4);
}

export const NOTE_LINE_WIDTH = 238;

function measureLineWidth(line) {
  let width = 0;
  for (const ch of String(line || '')) {
    width += /[^\x00-\xff]/.test(ch) ? 14 : 7;
  }
  return width;
}

export function wrapText(text, maxWidth = NOTE_LINE_WIDTH, maxLines = 0) {
  const limit = Number.isFinite(maxWidth) && maxWidth > 14 ? maxWidth : NOTE_LINE_WIDTH;
  const paragraphs = String(text || '').split(/\r?\n/);
  const lines = [];

  for (const paragraph of paragraphs) {
    if (!paragraph) {
      lines.push('');
      continue;
    }
    const chars = [...paragraph];
    let current = '';
    let width = 0;
    let lastBreakIndex = -1;

    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i];
      const advance = /[^\x00-\xff]/.test(ch) ? 14 : 7;
      if (width + advance > limit && current) {
        if (lastBreakIndex > 0) {
          const head = current.slice(0, lastBreakIndex).trimEnd();
          const tail = current.slice(lastBreakIndex + 1).replace(/^\s+/, '');
          lines.push(head);
          current = tail + (ch === ' ' && !tail ? '' : ch);
          width = measureLineWidth(current);
          lastBreakIndex = current.lastIndexOf(' ');
          continue;
        }
        lines.push(current);
        if (ch === ' ') {
          current = '';
          width = 0;
          lastBreakIndex = -1;
        } else {
          current = ch;
          width = advance;
          lastBreakIndex = -1;
        }
        continue;
      }
      if (ch === ' ') lastBreakIndex = current.length;
      current += ch;
      width += advance;
    }
    if (current || !lines.length) lines.push(current);
  }

  if (maxLines > 0 && lines.length > maxLines) {
    const clipped = lines.slice(0, maxLines);
    const lastChars = [...clipped[clipped.length - 1].trimEnd()];
    while (lastChars.length > 0 && measureLineWidth(lastChars.join('')) + 14 > limit) {
      lastChars.pop();
    }
    clipped[clipped.length - 1] = lastChars.join('').trimEnd() + '…';
    return clipped.join('\n');
  }
  return lines.join('\n');
}

export function preview(text, maxWidth = NOTE_LINE_WIDTH) {
  return wrapText(text, maxWidth, 3);
}

export function slider(value, color, width = CONTENT_WIDTH) {
  const sliderWidth = Math.max(130, Math.round(Number.isFinite(Number(width)) ? Number(width) : CONTENT_WIDTH));
  const track = sliderWidth - 14, at = 7 + track * (value || 0) / 100;
  const nodes = layout.progressNodes.map(n => `<circle cx="${7+track*n/100}" cy="12" r="3.5" fill="light-dark(#fff,#191919)" stroke="light-dark(#576374,#a0a6ad)" stroke-width="1"/><text x="${7+track*n/100}" y="38" font-size="10" fill="currentColor" text-anchor="${n === 0 ? 'start' : n === 100 ? 'end' : 'middle'}" opacity=".68">${n}</text>`).join('');
  return svg(`<rect x="7" y="10" width="${track}" height="4" rx="2" fill="light-dark(#c3ccd6,#ffffff12)"/><rect x="7" y="10" width="${track*(value||0)/100}" height="4" rx="2" fill="${color}"/>${nodes}<circle cx="${at}" cy="12" r="7" fill="light-dark(${accent.normal},#e6edf3)" stroke="light-dark(#fff,#191919)" stroke-width="2"/>`, sliderWidth, 51, 'xMinYMid meet');
}
export function measureButtonWidth(label, minWidth = BUTTON_WIDTH) {
  const w = textWidth(String(label || ''), 13);
  return Math.max(minWidth, Math.round(w + 26));
}
export function measureClearWidth(label, minWidth = 64) {
  const w = textWidth(String(label || ''), 11);
  return Math.max(minWidth, Math.round(w + 20));
}
export function primary(label, disabled, hovered = false, pressed = false, width = measureButtonWidth(label)) {
  const fill = disabled ? accent.normal : pressed ? accent.pressed : hovered ? accent.hover : accent.normal;
  return svg(`<rect width="${width}" height="36" rx="9" fill="${fill}" opacity="${disabled?'.5':'1'}"/><text x="${width/2}" y="23" fill="white" text-anchor="middle" font-size="13" font-weight="550">${escape(label)}</text>`, width, 36, 'xMidYMid meet');
}

// 「在侧栏打开」图标：右侧 28×28 为图标，悬停时在左侧画出提示。
export const PANE_ICON_WIDTH = 104;
export function paneIconWidth(tipLabel = strings?.openInSidebar || '在侧栏打开') {
  const label = String(tipLabel || '在侧栏打开');
  const tipW = label === '在侧栏打开' ? 70 : Math.max(70, Math.round(textWidth(label, 11) + 22));
  return tipW + 34;
}
export function paneIcon(hovered, pressed, tipLabel = strings?.openInSidebar || '在侧栏打开') {
  const label = String(tipLabel || '在侧栏打开');
  const tipW = label === '在侧栏打开' ? 70 : Math.max(70, Math.round(textWidth(label, 11) + 22));
  const totalW = tipW + 34;
  const iconX = tipW + 6;
  const tip = hovered ? `<rect x="0" y="3" width="${tipW}" height="22" rx="6" fill="light-dark(#22272e,#e6edf3)"/><text x="${tipW / 2}" y="18" text-anchor="middle" font-size="11" fill="light-dark(#fff,#191919)">${escape(label)}</text>` : '';
  const ink = hovered || pressed ? 'light-dark(#22272e,#e6edf3)' : 'light-dark(#576374,#a0a6ad)';
  const bg = hovered || pressed ? `<rect x="${iconX}" y="0" width="28" height="28" rx="6" fill="light-dark(#f0f3f6,#ffffff12)"/>` : '';
  return svg(`${tip}${bg}<rect x="${iconX + 7.65}" y="8.65" width="14.7" height="11.7" rx="3" fill="none" stroke="${ink}" stroke-width="1.3"/><path d="M${iconX + 17.3} 8.7V20.3" stroke="${ink}" stroke-width="1.3"/>`, totalW, 28, 'xMidYMid meet');
}
export function clearButton(hovered, pressed, label = strings?.btnClear || '清除进度', width = label === '清除进度' ? 64 : measureClearWidth(label)) {
  return svg(`<rect width="${width}" height="28" rx="6" fill="light-dark(#f0f1f2,#ffffff10)" opacity="${pressed ? 1 : hovered ? 1 : 0}"/><text x="${width / 2}" y="18" text-anchor="middle" font-size="11" fill="${hovered || pressed ? 'light-dark(#bf2f3a,#ef7777)' : 'light-dark(#667383,#828c96)'}">${escape(label)}</text>`, width, 28, 'xMidYMid meet');
}
