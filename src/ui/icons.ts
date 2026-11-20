/**
 * Hand-made 16px inline SVG icon set in Blender's style: monochrome (currentColor),
 * thin strokes, flat fills. No external icon fonts.
 */

const S = 'fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"';
const F = 'fill="currentColor" stroke="none"';

/** Raw inner markup for each icon (16x16 viewBox). Group attributes select stroke or fill rendering. */
const RAW = {
  scene: `<g ${S}><circle cx="8" cy="8" r="5.8"/><ellipse cx="8" cy="8" rx="2.6" ry="5.8"/><path d="M2.4 6.2h11.2M2.4 9.8h11.2"/></g>`,
  camera: `<g ${S}><path d="M1.8 5h7.4a.8.8 0 0 1 .8.8v4.4a.8.8 0 0 1-.8.8H1.8a.8.8 0 0 1-.8-.8V5.8A.8.8 0 0 1 1.8 5z"/><path d="M10 7.2l4.2-2.2v6L10 8.8"/></g>`,
  sun: `<g ${S}><circle cx="8" cy="8" r="2.7"/><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4"/></g>`,
  bulb: `<g ${S}><path d="M8 1.8a4.2 4.2 0 0 0-2.3 7.7V11h4.6V9.5A4.2 4.2 0 0 0 8 1.8z"/><path d="M6.2 13.2h3.6M7 14.6h2"/></g>`,
  mesh: `<g ${S}><path d="M8 1.8l6 11.4H2z"/><path d="M5 7.6h6M8 1.8v11.4M3.5 10.4l4.5-2.6 4.5 2.6"/></g>`,
  meshData: `<g ${S}><path d="M8 3l5 9H3z"/></g><g ${F}><circle cx="8" cy="3" r="1.2"/><circle cx="13" cy="12" r="1.2"/><circle cx="3" cy="12" r="1.2"/></g>`,
  image: `<g ${S}><rect x="1.8" y="2.8" width="12.4" height="10.4" rx="1.2"/><path d="M2.4 11.5l3.4-3.6 2.6 2.6 2-1.8 3.2 2.8"/></g><g ${F}><circle cx="10.6" cy="6" r="1.1"/></g>`,
  depth: `<g ${S}><rect x="1.8" y="2.8" width="12.4" height="10.4" rx="1.2"/></g><g ${F}><rect x="3.4" y="4.4" width="2" height="7.2" opacity=".95"/><rect x="6" y="4.4" width="2" height="7.2" opacity=".7"/><rect x="8.6" y="4.4" width="2" height="7.2" opacity=".45"/><rect x="11.2" y="4.4" width="1.4" height="7.2" opacity=".22"/></g>`,
  mask: `<g ${S}><circle cx="8" cy="8" r="5.6"/></g><path d="M8 2.4a5.6 5.6 0 0 1 0 11.2z" ${F}/>`,
  eye: `<g ${S}><path d="M1.2 8S3.9 3.6 8 3.6 14.8 8 14.8 8 12.1 12.4 8 12.4 1.2 8 1.2 8z"/><circle cx="8" cy="8" r="2"/></g>`,
  eyeOff: `<g ${S}><path d="M1.2 8S3.9 3.6 8 3.6 14.8 8 14.8 8 12.1 12.4 8 12.4 1.2 8 1.2 8z" opacity=".55"/><path d="M2.5 13.5l11-11"/></g>`,
  triRight: `<path d="M5.6 3.6l5.6 4.4-5.6 4.4z" ${F}/>`,
  triDown: `<path d="M3.6 5.6h8.8L8 11.2z" ${F}/>`,
  chevRight: `<path d="M6 3.5L10.5 8 6 12.5" ${S}/>`,
  chevDown: `<path d="M3.5 6L8 10.5 12.5 6" ${S}/>`,
  upDown: `<path d="M5 6.4L8 3.4l3 3M5 9.6l3 3 3-3" ${S}/>`,
  arrowLeft: `<path d="M10 3.2L5 8l5 4.8z" ${F}/>`,
  arrowRight: `<path d="M6 3.2L11 8l-5 4.8z" ${F}/>`,
  check: `<path d="M3.2 8.6l3 3L12.8 4.6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`,
  close: `<path d="M3.8 3.8l8.4 8.4M12.2 3.8l-8.4 8.4" ${S}/>`,
  plus: `<path d="M8 3v10M3 8h10" ${S}/>`,
  search: `<g ${S}><circle cx="6.8" cy="6.8" r="4.2"/><path d="M10 10l4.2 4.2"/></g>`,
  undo: `<g ${S}><path d="M3 6.2h6.4a3.4 3.4 0 0 1 0 6.8H5.5"/><path d="M5.6 3.4L2.8 6.2l2.8 2.8"/></g>`,
  redo: `<g ${S}><path d="M13 6.2H6.6a3.4 3.4 0 0 0 0 6.8h3.9"/><path d="M10.4 3.4l2.8 2.8-2.8 2.8"/></g>`,
  cursor: `<path d="M3.4 2l9.2 5.2-4.1 1.1 2.3 4.4-1.7.9-2.3-4.4L3.4 12.2z" ${F}/>`,
  move: `<g ${S}><path d="M8 1.8v12.4M1.8 8h12.4M8 1.8L6.2 3.6M8 1.8l1.8 1.8M8 14.2l-1.8-1.8M8 14.2l1.8-1.8M1.8 8l1.8-1.8M1.8 8l1.8 1.8M14.2 8l-1.8-1.8M14.2 8l-1.8 1.8"/></g>`,
  orbit: `<g ${S}><ellipse cx="8" cy="8" rx="6.4" ry="3"/><path d="M12.6 4.6l.9 2.6-2.6.5" transform="rotate(8 8 8)"/><circle cx="8" cy="8" r="1.3" fill="currentColor"/></g>`,
  lightDir: `<g ${S}><circle cx="5.2" cy="5.2" r="2.2"/><path d="M5.2 1.2v.8M1.2 5.2h.8M2.4 2.4l.6.6"/><path d="M7.4 7.4l6.2 6.2M13.6 9.4v4.2H9.4"/></g>`,
  brush: `<g ${S}><path d="M13.4 2.6c-1.6.6-5 3.6-6.4 6l1.4 1.4c2.4-1.4 5.4-4.8 6-6.4z"/><path d="M6.6 9.4C4.8 9.4 4.4 11 3.8 12.4c-.4.9-1.4 1-2 1 1.6 1 5.4.8 6-2.4z"/></g>`,
  eyedropper: `<g ${S}><path d="M13.6 2.4a2 2 0 0 0-2.8 0L9 4.2 7.8 3l-1 1 1.2 1.2-5 5v2.6L5.2 13l5-5 1.2 1.2 1-1L11.2 7l1.8-1.8a2 2 0 0 0 .6-2.8z"/></g>`,
  aperture: `<g ${S}><circle cx="8" cy="8" r="6"/><path d="M8 2l3.2 5.5M2.8 5l6.4.2M2.8 11l3.2-5.5M8 14l-3.2-5.5M13.2 11l-6.4-.2M13.2 5l-3.2 5.5"/></g>`,
  shadedSphere: `<g ${S}><circle cx="8" cy="8" r="5.8"/></g><path d="M8 2.2A5.8 5.8 0 0 0 8 13.8a4.2 4.2 0 0 1 0-11.6z" ${F} opacity=".85"/>`,
  wireframe: `<g ${S}><path d="M8 1.8l5.6 3.1v6.2L8 14.2 2.4 11.1V4.9z"/><path d="M2.4 4.9L8 8l5.6-3.1M8 8v6.2"/></g>`,
  layers: `<g ${S}><path d="M8 2l6.2 3.2L8 8.4 1.8 5.2z"/><path d="M1.8 8.2L8 11.4l6.2-3.2"/><path d="M1.8 11L8 14.2 14.2 11"/></g>`,
  view3d: `<g ${S}><path d="M8 1.8l5.8 3.2v6L8 14.2 2.2 11V5z"/><path d="M2.2 5L8 8.2 13.8 5M8 8.2v6"/></g><path d="M8 8.2L13.8 5 8 1.8 2.2 5z" ${F} opacity=".35"/>`,
  imageEditor: `<g ${S}><rect x="1.8" y="2.4" width="12.4" height="11.2" rx="1.2"/><path d="M1.8 5.6h12.4"/><path d="M3.6 12l3-3 2.2 2.2 1.6-1.4 2 2.2"/></g>`,
  wrench: `<g ${S}><path d="M9.6 2.2a3.6 3.6 0 0 0-3.2 4.8L2.2 11.2a1.4 1.4 0 0 0 2 2L8.4 9.2a3.6 3.6 0 0 0 4.8-3.2L11.2 8 9 6.8 8 4.6z"/></g>`,
  selectBox: `<g ${S} stroke-dasharray="2.2 1.8"><rect x="2" y="2.4" width="12" height="11.2" rx="1"/></g><path d="M7 6.4l5.4 2.8-2.4.8 1.3 2.4-1 .6L9 10.6l-1.7 1.6z" ${F}/>`,
  patch: `<g ${S}><rect x="2" y="2.4" width="12" height="11.2" rx="1.2"/><rect x="5.4" y="5.6" width="5.2" height="4.8" rx=".8" stroke-dasharray="1.6 1.4"/></g>`,
  printer: `<g ${S}><path d="M4.4 5.4V2h7.2v3.4"/><rect x="1.8" y="5.4" width="12.4" height="6" rx="1.2"/><path d="M4.4 9.4h7.2v4.4H4.4z"/></g>`,
  cpu: `<g ${S}><rect x="3.6" y="3.6" width="8.8" height="8.8" rx="1.2"/><rect x="6" y="6" width="4" height="4"/><path d="M6 1.6v2M10 1.6v2M6 12.4v2M10 12.4v2M1.6 6h2M1.6 10h2M12.4 6h2M12.4 10h2"/></g>`,
  folder: `<g ${S}><path d="M1.8 4.2a1 1 0 0 1 1-1h3.2l1.6 1.8h5.6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H2.8a1 1 0 0 1-1-1z"/></g>`,
  file: `<g ${S}><path d="M3.6 1.8h5.6l3.2 3.2v8.4a.8.8 0 0 1-.8.8H3.6a.8.8 0 0 1-.8-.8V2.6a.8.8 0 0 1 .8-.8z"/><path d="M9.2 1.8V5h3.2"/></g>`,
  save: `<g ${S}><path d="M2.6 2h8.6l2.4 2.4v8.6a.8.8 0 0 1-.8.8H2.6a.8.8 0 0 1-.8-.8V2.8a.8.8 0 0 1 .8-.8z"/><path d="M4.8 2v3.6h5V2M4.6 14v-4h6.8v4"/></g>`,
  export: `<g ${S}><path d="M8 10V1.8M5 4.6l3-3 3 3"/><path d="M3.2 8v5.2h9.6V8"/></g>`,
  import: `<g ${S}><path d="M8 1.8V10M5 7l3 3 3-3"/><path d="M3.2 8v5.2h9.6V8"/></g>`,
  download: `<g ${S}><path d="M8 2v8.4M5 7.6l3 3 3-3M2.6 13.6h10.8"/></g>`,
  fullscreen: `<g ${S}><path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4"/></g>`,
  gear: `<g ${S}><circle cx="8" cy="8" r="2.2"/><path d="M8 1.6l1 1.6 1.8-.4.6 1.8 1.8.6-.4 1.8L14.4 8l-1.6 1 .4 1.8-1.8.6-.6 1.8-1.8-.4L8 14.4l-1-1.6-1.8.4-.6-1.8-1.8-.6.4-1.8L1.6 8l1.6-1-.4-1.8 1.8-.6.6-1.8 1.8.4z"/></g>`,
  info: `<g ${S}><circle cx="8" cy="8" r="6.2"/><path d="M8 7.2v4.2"/></g><circle cx="8" cy="4.8" r="1" ${F}/>`,
  warning: `<g ${S}><path d="M8 2l6.4 11.4H1.6z"/><path d="M8 6.4v3.4"/></g><circle cx="8" cy="11.6" r=".9" ${F}/>`,
  error: `<g ${S}><circle cx="8" cy="8" r="6.2"/><path d="M8 4.4v4.2"/></g><circle cx="8" cy="11.2" r=".9" ${F}/>`,
  success: `<g ${S}><circle cx="8" cy="8" r="6.2"/><path d="M5 8.2l2.2 2.2L11 6"/></g>`,
  trash: `<g ${S}><path d="M2.8 4.2h10.4M6 4.2V2.6h4v1.6M4 4.2l.6 9.2h6.8l.6-9.2M6.6 6.6v4.4M9.4 6.6v4.4"/></g>`,
  refresh: `<g ${S}><path d="M13.4 8a5.4 5.4 0 1 1-1.6-3.8"/><path d="M13.4 2.4v3.2H10.2"/></g>`,
  grip: `<g ${F}><circle cx="6" cy="4" r="1"/><circle cx="10" cy="4" r="1"/><circle cx="6" cy="8" r="1"/><circle cx="10" cy="8" r="1"/><circle cx="6" cy="12" r="1"/><circle cx="10" cy="12" r="1"/></g>`,
  sidebar: `<g ${S}><rect x="1.8" y="2.6" width="12.4" height="10.8" rx="1.2"/><path d="M10 2.6v10.8"/></g><rect x="10" y="2.6" width="4.2" height="10.8" ${F} opacity=".4"/>`,
  grid: `<g ${S}><path d="M2 2h12v12H2zM2 6h12M2 10h12M6 2v12M10 2v12"/></g>`,
  gizmo: `<g ${S}><circle cx="8" cy="8" r="2"/><path d="M8 6V2M9.6 9.2l3 2.4M6.4 9.2l-3 2.4"/></g>`,
  cube: `<g ${S}><path d="M8 1.8l5.8 3.2v6L8 14.2 2.2 11V5z"/><path d="M2.2 5L8 8.2 13.8 5M8 8.2v6"/></g>`,
  keyboard: `<g ${S}><rect x="1.4" y="3.6" width="13.2" height="8.8" rx="1.2"/><path d="M4 6.4h1M7.5 6.4h1M11 6.4h1M4 9.6h8"/></g>`,
  help: `<g ${S}><circle cx="8" cy="8" r="6.2"/><path d="M6 6.2a2 2 0 1 1 3 1.7c-.7.4-1 .9-1 1.6"/></g><circle cx="8" cy="11.6" r=".9" ${F}/>`,
  shield: `<g ${S}><path d="M8 1.8l5 1.8v4.2c0 3-2.2 5-5 6.4-2.8-1.4-5-3.4-5-6.4V3.6z"/><path d="M5.8 8l1.6 1.6L10.4 6.4"/></g>`,
  sparkle: `<g ${F}><path d="M8 1.6l1.5 4.4 4.4 1.5-4.4 1.5L8 13.4 6.5 9 2.1 7.5 6.5 6z"/></g>`,
  link: `<g ${S}><path d="M6.8 9.2a2.6 2.6 0 0 0 3.7 0l2.2-2.2a2.6 2.6 0 0 0-3.7-3.7l-.8.8"/><path d="M9.2 6.8a2.6 2.6 0 0 0-3.7 0L3.3 9a2.6 2.6 0 0 0 3.7 3.7l.8-.8"/></g>`,
  dots: `<g ${F}><circle cx="3.6" cy="8" r="1.2"/><circle cx="8" cy="8" r="1.2"/><circle cx="12.4" cy="8" r="1.2"/></g>`,
  collection: `<g ${S}><path d="M1.8 4.4a1 1 0 0 1 1-1h3l1.4 1.6h6a1 1 0 0 1 1 1v6.2a1 1 0 0 1-1 1H2.8a1 1 0 0 1-1-1z"/></g><rect x="1.8" y="6.2" width="12.4" height="6.6" rx="1" ${F} opacity=".25"/>`,
  mouseL: `<g ${S}><rect x="3.4" y="1.6" width="9.2" height="12.8" rx="4.6"/><path d="M8 1.6v5.2M3.4 6.8h9.2"/></g><path d="M8 1.6H8a4.6 4.6 0 0 0-4.6 4.6v.6H8z" ${F}/>`,
  mouseM: `<g ${S}><rect x="3.4" y="1.6" width="9.2" height="12.8" rx="4.6"/><path d="M3.4 6.8h9.2"/></g><rect x="7" y="2.6" width="2" height="3.4" rx="1" ${F}/>`,
  mouseR: `<g ${S}><rect x="3.4" y="1.6" width="9.2" height="12.8" rx="4.6"/><path d="M8 1.6v5.2M3.4 6.8h9.2"/></g><path d="M8 1.6h0a4.6 4.6 0 0 1 4.6 4.6v.6H8z" ${F}/>`,
  mouseWheel: `<g ${S}><rect x="3.4" y="1.6" width="9.2" height="12.8" rx="4.6"/></g><rect x="7" y="3.4" width="2" height="3.8" rx="1" ${F}/>`,
  lock: `<g ${S}><rect x="3.4" y="7" width="9.2" height="6.8" rx="1.2"/><path d="M5.4 7V5a2.6 2.6 0 0 1 5.2 0v2"/></g>`,
  pin: `<g ${S}><path d="M9.6 2l4.4 4.4-1.8.4-2.4 2.4.2 2.8L9 13 5.6 9.6 2 13.2 8 7l-1.4-1.4z"/></g>`,
} as const;

export type IconName = keyof typeof RAW | 'logo';

const LOGO = `
<path d="M2 11.2 8 14l6-2.8V9.4L8 12.2 2 9.4z" fill="#2c4d85"/>
<path d="M2 8.4 8 11.2l6-2.8V6.6L8 9.4 2 6.6z" fill="#4772b3"/>
<path d="M8 2 14 4.8v1.6L8 9.2 2 6.4V4.8z" fill="#ffa033"/>
<path d="M8 2 2 4.8l6 2.8 6-2.8z" fill="#ffc678"/>
<path d="M8 3.4 5 4.8l3 1.4 3-1.4z" fill="#ff8a00" opacity=".55"/>`;

/** Return an SVG string for the icon at the requested pixel size. */
export function iconSvg(name: IconName, size = 16): string {
  const inner = name === 'logo' ? LOGO : RAW[name];
  return `<svg class="pw-icon-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="${size}" height="${size}" aria-hidden="true" focusable="false">${inner}</svg>`;
}

/** Create a `<span class="pw-icon">` containing the icon. */
export function icon(name: IconName, size = 16): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = `pw-icon pw-icon-${name}`;
  span.innerHTML = iconSvg(name, size);
  return span;
}
