# Unused CSS Detector

A VS Code extension that detects unused CSS selectors in React and Angular components.

## Features

- **React Component Analysis**: Automatically detects imported CSS in `.jsx/.tsx` files
- **Angular Component Analysis**: Detects `@Component` decorators and analyzes their templates and styleUrls
- **JSX Parsing**: Collects used `className` and `id` attributes from JSX elements
- **Angular Template Parsing**: Extracts class and id usage from Angular templates
- **CSS Parsing**: Uses PostCSS to parse linked CSS files and extract selectors
- **Real-time Detection**: Shows unused selectors as Problems panel warnings with red underlines
- **Status Bar Integration**: Displays count of unused selectors in the status bar
- **Enhanced Tooltips**: Detailed hover information for each unused selector warning
- **Auto-analysis**: Runs automatically on file save and when switching between files

## Supported Files

- **CSS Files**: `.css`, `.scss`, `.less`
- **React Components**: `.jsx`, `.tsx`
- **Angular Components**: `.ts` (with `@Component` decorator)

## How it Works

1. Scans workspace for CSS, React, and Angular component files
2. Parses CSS files to extract class and ID selectors
3. Analyzes React components to find used `className` and `id` attributes
4. Analyzes Angular components by:
   - Detecting `@Component` decorators
   - Reading `templateUrl` and inline `template` properties
   - Parsing Angular templates for class and id usage
   - Supporting Angular-specific syntax like `[class.className]` and `[ngClass]`
5. Compares selectors with usage and highlights unused ones
6. Displays results in VS Code's Problems panel with warning severity

## Usage

- **Automatic**: The extension runs automatically when you save files or switch between files
- **Manual**: Use Command Palette (`Ctrl+Shift+P`) and search for "Analyze Unused CSS"
- **Status Bar**: Click the status bar item to manually trigger analysis
- **Hover Tooltips**: Hover over any unused CSS warning to see detailed information including:
  - File location and line/column numbers
  - Analysis summary (files scanned)
  - Suggestions for cleanup

## Status Bar Indicators

- `$(check) No unused CSS` - All selectors are being used (green)
- `$(warning) X unused CSS selectors` - Found unused selectors (red)
- `$(sync~spin) Analyzing CSS...` - Analysis in progress (yellow)

## Installation

### From VS Code Marketplace
1. Open VS Code
2. Go to Extensions (Ctrl+Shift+X)
3. Search for "Unused CSS Detector"
4. Click Install

### From VSIX
1. Download the latest `.vsix` file from releases
2. Open VS Code
3. Run `Extensions: Install from VSIX...` from Command Palette
4. Select the downloaded file

## Development Setup

1. Clone the repository
2. Install dependencies: `npm install`
3. Compile: `npm run compile`
4. Press `F5` to run the extension in a new Extension Development Host window

## Configuration

The extension is highly configurable through VS Code settings. See [CONFIGURATION.md](CONFIGURATION.md) for detailed documentation.

### Quick Settings
```json
{
  "unusedCssDetector.autoAnalyze": true,
  "unusedCssDetector.excludePatterns": [
    "**/node_modules/**",
    "**/dist/**",
    "*build/**"
  ],
  "unusedCssDetector.showStatusBar": true,
  "unusedCssDetector.showNotifications": true,
  "unusedCssDetector.debounceDelay": 500
}
```

### Available Settings
- **Auto Analysis**: Enable/disable automatic analysis on file changes
- **File Patterns**: Configure which files to include/exclude
- **Status Bar**: Show/hide status bar integration
- **Notifications**: Control analysis completion messages
- **Performance**: Debounce delays and minimum file thresholds

## Supported Patterns

### React Patterns
- Static strings: `className="btn primary"`
- Template literals: `className={\`btn \${isActive ? 'active' : ''}\`}`
- CSS Modules: `className={styles.button}`
- Function calls: `className={clsx('btn', { active: isActive })}`
- Arrays: `className={['btn', 'primary']}`
- Objects: `className={{ 'btn': true, 'active': isActive }}`

### Angular Patterns
- Static class attributes: `class="btn primary"`
- Class binding: `[class.active]="isActive"`
- NgClass directive: `[ngClass]="dynamicClass"`
- Interpolation: `class="{{ dynamicClass }}"`
- ID attributes: `id="main-content"`
- Component decorator properties:
  - `templateUrl: './component.html'`
  - `template: '<div class="inline">...</div>'`
  - `styleUrls: ['./styles.css']`