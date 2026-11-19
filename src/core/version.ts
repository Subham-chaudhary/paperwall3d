declare const __APP_VERSION__: string;

export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0-dev';
export const APP_NAME = 'PaperWall3D';
export const CONFIG_SCHEMA_VERSION = 1;
