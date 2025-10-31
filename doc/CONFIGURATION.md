# ⚙️ Configuration Guide

## Extension Settings

The Unused CSS Detector extension can be customized through VS Code settings. Access these through:
- **File > Preferences > Settings** (Windows/Linux)
- **Code > Preferences > Settings** (macOS)
- Search for "Unused CSS Detector"

## Available Settings

### `unusedCssDetector.autoAnalyze`
- **Type**: `boolean`
- **Default**: `true`
- **Description**: Automatically analyze CSS when files are saved or opened
- **Example**: 
  ```json
  "unusedCssDetector.autoAnalyze": false
  ```

### `unusedCssDetector.excludePatterns`
- **Type**: `array` of `string`
- **Default**: `["**/node_modules/**", "**/dist/**", "**/build/**", "**/.git/**"]`
- **Description**: Glob patterns for files and directories to exclude from analysis
- **Example**:
  ```json
  "unusedCssDetector.excludePatterns": [
    "**/node_modules/**",
    "**/dist/**",
    "**/build/**",
    "**/coverage/**",
    "**/.next/**",
    "**/public/**"
  ]
  ```

### `unusedCssDetector.includeFileTypes`
- **Type**: `array` of `string`
- **Default**: `[".css", ".scss", ".less"]`
- **Description**: CSS file extensions to analyze
- **Example**:
  ```json
  "unusedCssDetector.includeFileTypes": [
    ".css",
    ".scss",
    ".sass",
    ".less",
    ".stylus"
  ]
  ```

### `unusedCssDetector.componentFileTypes`
- **Type**: `array` of `string`
- **Default**: `[".jsx", ".tsx", ".ts", ".js"]`
- **Description**: Component file extensions to scan for CSS usage
- **Example**:
  ```json
  "unusedCssDetector.componentFileTypes": [
    ".jsx",
    ".tsx",
    ".ts",
    ".js",
    ".vue",
    ".svelte"
  ]
  ```

### `unusedCssDetector.showStatusBar`
- **Type**: `boolean`
- **Default**: `true`
- **Description**: Show unused CSS count in status bar
- **Example**:
  ```json
  "unusedCssDetector.showStatusBar": false
  ```

### `unusedCssDetector.showNotifications`
- **Type**: `boolean`
- **Default**: `true`
- **Description**: Show notification messages when analysis completes
- **Example**:
  ```json
  "unusedCssDetector.showNotifications": false
  ```

### `unusedCssDetector.minFilesForAnalysis`
- **Type**: `number`
- **Default**: `1`
- **Minimum**: `1`
- **Description**: Minimum number of CSS files required to trigger analysis
- **Example**:
  ```json
  "unusedCssDetector.minFilesForAnalysis": 3
  ```

### `unusedCssDetector.debounceDelay`
- **Type**: `number`
- **Default**: `500`
- **Range**: `0` to `5000`
- **Description**: Delay in milliseconds before analyzing after file changes
- **Example**:
  ```json
  "unusedCssDetector.debounceDelay": 1000
  ```

## Configuration Examples

### Minimal Configuration (Performance Focused)
```json
{
  "unusedCssDetector.autoAnalyze": false,
  "unusedCssDetector.showNotifications": false,
  "unusedCssDetector.debounceDelay": 2000,
  "unusedCssDetector.minFilesForAnalysis": 5
}
```

### Comprehensive Configuration (Full Coverage)
```json
{
  "unusedCssDetector.autoAnalyze": true,
  "unusedCssDetector.excludePatterns": [
    "**/node_modules/**",
    "**/dist/**",
    "**/build/**",
    "**/coverage/**",
    "**/.next/**",
    "**/public/**",
    "**/vendor/**"
  ],
  "unusedCssDetector.includeFileTypes": [
    ".css",
    ".scss",
    ".sass",
    ".less"
  ],
  "unusedCssDetector.componentFileTypes": [
    ".jsx",
    ".tsx",
    ".ts",
    ".js",
    ".vue"
  ],
  "unusedCssDetector.showStatusBar": true,
  "unusedCssDetector.showNotifications": true,
  "unusedCssDetector.minFilesForAnalysis": 1,
  "unusedCssDetector.debounceDelay": 500
}
```

### Large Project Configuration
```json
{
  "unusedCssDetector.autoAnalyze": true,
  "unusedCssDetector.excludePatterns": [
    "**/node_modules/**",
    "**/dist/**",
    "**/build/**",
    "**/coverage/**",
    "**/storybook-static/**",
    "**/e2e/**",
    "**/cypress/**"
  ],
  "unusedCssDetector.debounceDelay": 2000,
  "unusedCssDetector.minFilesForAnalysis": 3,
  "unusedCssDetector.showNotifications": false
}
```

## Workspace vs User Settings

### User Settings (Global)
Apply to all VS Code workspaces:
```json
{
  "unusedCssDetector.showStatusBar": true,
  "unusedCssDetector.showNotifications": false
}
```

### Workspace Settings (Project-specific)
Create `.vscode/settings.json` in your project:
```json
{
  "unusedCssDetector.excludePatterns": [
    "**/node_modules/**",
    "**/dist/**",
    "**/my-custom-build/**"
  ],
  "unusedCssDetector.debounceDelay": 1000
}
```

## Performance Tips

### For Large Projects
- Increase `debounceDelay` to reduce frequent analysis
- Set `minFilesForAnalysis` higher to skip small projects
- Add more specific `excludePatterns`
- Disable `showNotifications` to reduce interruptions

### For Small Projects
- Keep default settings for responsive analysis
- Enable `showNotifications` for immediate feedback
- Lower `debounceDelay` for faster response

## Troubleshooting

### Extension Not Working?
1. Check if `autoAnalyze` is enabled
2. Verify file types are included in `includeFileTypes` and `componentFileTypes`
3. Check if files are excluded by `excludePatterns`
4. Ensure minimum file count is met (`minFilesForAnalysis`)

### Performance Issues?
1. Increase `debounceDelay`
2. Add more exclusion patterns
3. Increase `minFilesForAnalysis`
4. Disable `autoAnalyze` and use manual analysis

### Status Bar Not Showing?
1. Check `showStatusBar` setting
2. Restart VS Code after changing settings
3. Verify extension is active