/// <reference types="wxt" />

// WXT global functions that TypeScript doesn't recognize
declare const defineContentScript: (config: unknown) => unknown;
declare const defineBackground: (callback: () => void) => { default: () => void };
declare const defineUnlistedScript: (config: unknown) => unknown;