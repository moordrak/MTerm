/* MTerm - teme terminala. Sučelje se automatski usklađuje s odabranom temom. */
'use strict';

const ANSI = (black, red, green, yellow, blue, magenta, cyan, white,
  bBlack, bRed, bGreen, bYellow, bBlue, bMagenta, bCyan, bWhite) => ({
  black, red, green, yellow, blue, magenta, cyan, white,
  brightBlack: bBlack, brightRed: bRed, brightGreen: bGreen, brightYellow: bYellow,
  brightBlue: bBlue, brightMagenta: bMagenta, brightCyan: bCyan, brightWhite: bWhite,
});

const SOL = ANSI('#073642', '#dc322f', '#859900', '#b58900', '#268bd2', '#d33682', '#2aa198', '#eee8d5',
  '#002b36', '#cb4b16', '#586e75', '#657b83', '#839496', '#6c71c4', '#93a1a1', '#fdf6e3');

window.MTERM_THEMES = {
  dark: { name: 'MTerm tamna', accent: '#22d3ee', colors: {
    background: '#000000', foreground: '#e5e7eb', cursor: '#22d3ee', selectionBackground: '#164e63',
    ...ANSI('#1f2937', '#ef4444', '#22c55e', '#eab308', '#3b82f6', '#a855f7', '#06b6d4', '#d1d5db',
      '#4b5563', '#f87171', '#4ade80', '#facc15', '#60a5fa', '#c084fc', '#22d3ee', '#f9fafb') } },
  midnight: { name: 'Ponoćno plava', accent: '#38bdf8', colors: {
    background: '#0b1020', foreground: '#dbe4f3', cursor: '#38bdf8', selectionBackground: '#1e3a5f',
    ...ANSI('#1e293b', '#f43f5e', '#10b981', '#f59e0b', '#3b82f6', '#8b5cf6', '#06b6d4', '#cbd5e1',
      '#475569', '#fb7185', '#34d399', '#fbbf24', '#60a5fa', '#a78bfa', '#22d3ee', '#f8fafc') } },
  dracula: { name: 'Dracula', accent: '#bd93f9', colors: {
    background: '#282a36', foreground: '#f8f8f2', cursor: '#f8f8f2', selectionBackground: '#44475a',
    ...ANSI('#21222c', '#ff5555', '#50fa7b', '#f1fa8c', '#bd93f9', '#ff79c6', '#8be9fd', '#f8f8f2',
      '#6272a4', '#ff6e6e', '#69ff94', '#ffffa5', '#d6acff', '#ff92df', '#a4ffff', '#ffffff') } },
  nord: { name: 'Nord', accent: '#88c0d0', colors: {
    background: '#2e3440', foreground: '#d8dee9', cursor: '#d8dee9', selectionBackground: '#434c5e',
    ...ANSI('#3b4252', '#bf616a', '#a3be8c', '#ebcb8b', '#81a1c1', '#b48ead', '#88c0d0', '#e5e9f0',
      '#4c566a', '#bf616a', '#a3be8c', '#ebcb8b', '#81a1c1', '#b48ead', '#8fbcbb', '#eceff4') } },
  monokai: { name: 'Monokai', accent: '#a6e22e', colors: {
    background: '#272822', foreground: '#f8f8f2', cursor: '#f8f8f0', selectionBackground: '#49483e',
    ...ANSI('#272822', '#f92672', '#a6e22e', '#f4bf75', '#66d9ef', '#ae81ff', '#a1efe4', '#f8f8f2',
      '#75715e', '#f92672', '#a6e22e', '#f4bf75', '#66d9ef', '#ae81ff', '#a1efe4', '#f9f8f5') } },
  gruvbox: { name: 'Gruvbox', accent: '#fabd2f', colors: {
    background: '#282828', foreground: '#ebdbb2', cursor: '#ebdbb2', selectionBackground: '#504945',
    ...ANSI('#282828', '#cc241d', '#98971a', '#d79921', '#458588', '#b16286', '#689d6a', '#a89984',
      '#928374', '#fb4934', '#b8bb26', '#fabd2f', '#83a598', '#d3869b', '#8ec07c', '#ebdbb2') } },
  onedark: { name: 'One Dark', accent: '#61afef', colors: {
    background: '#282c34', foreground: '#abb2bf', cursor: '#528bff', selectionBackground: '#3e4451',
    ...ANSI('#282c34', '#e06c75', '#98c379', '#e5c07b', '#61afef', '#c678dd', '#56b6c2', '#abb2bf',
      '#5c6370', '#e06c75', '#98c379', '#e5c07b', '#61afef', '#c678dd', '#56b6c2', '#ffffff') } },
  tokyonight: { name: 'Tokyo Night', accent: '#7aa2f7', colors: {
    background: '#1a1b26', foreground: '#c0caf5', cursor: '#c0caf5', selectionBackground: '#33467c',
    ...ANSI('#15161e', '#f7768e', '#9ece6a', '#e0af68', '#7aa2f7', '#bb9af7', '#7dcfff', '#a9b1d6',
      '#414868', '#f7768e', '#9ece6a', '#e0af68', '#7aa2f7', '#bb9af7', '#7dcfff', '#c0caf5') } },
  catppuccin: { name: 'Catppuccin Mocha', accent: '#cba6f7', colors: {
    background: '#1e1e2e', foreground: '#cdd6f4', cursor: '#f5e0dc', selectionBackground: '#585b70',
    ...ANSI('#45475a', '#f38ba8', '#a6e3a1', '#f9e2af', '#89b4fa', '#f5c2e7', '#94e2d5', '#bac2de',
      '#585b70', '#f38ba8', '#a6e3a1', '#f9e2af', '#89b4fa', '#f5c2e7', '#94e2d5', '#a6adc8') } },
  rosepine: { name: 'Rosé Pine', accent: '#ebbcba', colors: {
    background: '#191724', foreground: '#e0def4', cursor: '#e0def4', selectionBackground: '#403d52',
    ...ANSI('#26233a', '#eb6f92', '#31748f', '#f6c177', '#9ccfd8', '#c4a7e7', '#ebbcba', '#e0def4',
      '#6e6a86', '#eb6f92', '#31748f', '#f6c177', '#9ccfd8', '#c4a7e7', '#ebbcba', '#e0def4') } },
  synthwave: { name: 'Synthwave \'84', accent: '#ff7edb', colors: {
    background: '#262335', foreground: '#ffffff', cursor: '#ff7edb', selectionBackground: '#463465',
    ...ANSI('#262335', '#fe4450', '#72f1b8', '#fede5d', '#03edf9', '#ff7edb', '#03edf9', '#ffffff',
      '#614d85', '#fe4450', '#72f1b8', '#f97e72', '#03edf9', '#ff7edb', '#03edf9', '#ffffff') } },
  githubdark: { name: 'GitHub tamna', accent: '#58a6ff', colors: {
    background: '#0d1117', foreground: '#c9d1d9', cursor: '#58a6ff', selectionBackground: '#264f78',
    ...ANSI('#484f58', '#ff7b72', '#3fb950', '#d29922', '#58a6ff', '#bc8cff', '#39c5cf', '#b1bac4',
      '#6e7681', '#ffa198', '#56d364', '#e3b341', '#79c0ff', '#d2a8ff', '#56d4dd', '#f0f6fc') } },
  solarized: { name: 'Solarized tamna', accent: '#2aa198', colors: {
    background: '#002b36', foreground: '#839496', cursor: '#93a1a1', selectionBackground: '#073642', ...SOL } },
  ubuntu: { name: 'Ubuntu', accent: '#e95420', colors: {
    background: '#300a24', foreground: '#eeeeec', cursor: '#eeeeec', selectionBackground: '#5e2750',
    ...ANSI('#2e3436', '#cc0000', '#4e9a06', '#c4a000', '#3465a4', '#75507b', '#06989a', '#d3d7cf',
      '#555753', '#ef2929', '#8ae234', '#fce94f', '#729fcf', '#ad7fa8', '#34e2e2', '#eeeeec') } },
  powershell: { name: 'PowerShell', accent: '#3a96dd', colors: {
    background: '#012456', foreground: '#eeedf0', cursor: '#fedba9', selectionBackground: '#264f78',
    ...ANSI('#0c0c0c', '#c50f1f', '#13a10e', '#c19c00', '#0037da', '#881798', '#3a96dd', '#cccccc',
      '#767676', '#e74856', '#16c60c', '#f9f1a5', '#3b78ff', '#b4009e', '#61d6d6', '#f2f2f2') } },
  matrix: { name: 'Matrix (zeleni fosfor)', accent: '#33ff66', colors: {
    background: '#020a04', foreground: '#33ff66', cursor: '#33ff66', selectionBackground: '#0f4d1f',
    ...ANSI('#020a04', '#2bd94f', '#33ff66', '#7dff9a', '#1fa83f', '#5cff85', '#9dffb3', '#b8ffc9',
      '#0f4d1f', '#4dff78', '#66ff8c', '#a3ffb8', '#33cc55', '#80ffa0', '#ccffd9', '#e6ffec') } },
  amber: { name: 'Jantar (retro)', accent: '#ffb000', colors: {
    background: '#140c00', foreground: '#ffb000', cursor: '#ffcc00', selectionBackground: '#4d3500',
    ...ANSI('#140c00', '#ff8c00', '#ffb000', '#ffd060', '#cc8800', '#ff9f40', '#ffc94d', '#ffe0a0',
      '#4d3500', '#ffa033', '#ffc233', '#ffe08c', '#e69900', '#ffb366', '#ffd980', '#fff0cc') } },
  solarizedlight: { name: 'Solarized svijetla', accent: '#268bd2', colors: {
    background: '#fdf6e3', foreground: '#657b83', cursor: '#586e75', selectionBackground: '#eee8d5', ...SOL } },
  githublight: { name: 'GitHub svijetla', accent: '#0969da', colors: {
    background: '#ffffff', foreground: '#24292f', cursor: '#0969da', selectionBackground: '#b6e3ff',
    ...ANSI('#24292f', '#cf222e', '#116329', '#4d2d00', '#0969da', '#8250df', '#1b7c83', '#6e7781',
      '#57606a', '#a40e26', '#1a7f37', '#633c01', '#218bff', '#a475f9', '#3192aa', '#8c959f') } },
  light: { name: 'Svijetla', accent: '#0891b2', colors: {
    background: '#fafafa', foreground: '#1f2937', cursor: '#0891b2', selectionBackground: '#bae6fd',
    ...ANSI('#1f2937', '#dc2626', '#16a34a', '#a16207', '#2563eb', '#9333ea', '#0891b2', '#9ca3af',
      '#4b5563', '#ef4444', '#22c55e', '#854d0e', '#3b82f6', '#a855f7', '#06b6d4', '#6b7280') } },
};
