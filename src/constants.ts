export const IGNORE_PATTERNS = [
  "**/node_modules/**",
  "**/dist/**",
  "**/.git/**",
  "**/.nuxt/**",
  "**/.output/**",
  "**/miniprogram_npm/**",
  "**/.svn/**",
];

export const SOURCE_GLOB = "**/*.{js,ts,vue,wxs,jsx,tsx}";

export const TRACKING_FILE_GLOBS: { glob: string; type: string }[] = [
  { glob: "**/plugins/*track*.{js,ts}", type: "plugin" },
  { glob: "**/plugins/*sensor*.{js,ts}", type: "plugin" },
  { glob: "**/plugins/*analytics*.{js,ts}", type: "plugin" },
  { glob: "**/composables/useTrack*.{js,ts}", type: "composable" },
  { glob: "**/composables/useAnalytics*.{js,ts}", type: "composable" },
  { glob: "**/utils/track*.{js,ts}", type: "util" },
  { glob: "**/utils/analytics*.{js,ts}", type: "util" },
  { glob: "**/utils/sensor*.{js,ts}", type: "sdk" },
  { glob: "**/utils/sensorsdata*.{js,ts}", type: "sdk" },
  { glob: "**/TRACKER*.{js,ts}", type: "tracker" },
  { glob: "**/mixins/*exposure*.{js,ts}", type: "exposure-mixin" },
  { glob: "**/directives/track*.{js,ts}", type: "directive" },
  { glob: "**/middleware/*track*.{js,ts}", type: "middleware" },
];
