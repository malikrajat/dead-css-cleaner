# Change Log

All notable changes to the "unused-css-detector" extension will be documented in this file.

## [0.0.1] - 2024-10-31

### Added
- Initial release of Unused CSS Detector
- React component analysis for unused CSS selectors
- Angular component analysis with @Component decorator detection
- Real-time CSS parsing using PostCSS
- JSX parsing with Babel for className and id extraction
- Angular template parsing for class and id usage
- Status bar integration showing unused selector count
- Enhanced hover tooltips with detailed information
- Problems panel integration with warnings and red underlines
- Auto-analysis on file save and editor changes
- Support for various CSS file types (.css, .scss, .less)
- Support for React (.jsx, .tsx) and Angular (.ts) components
- Command palette integration for manual analysis
- Comprehensive pattern recognition:
  - Static class strings
  - Template literals
  - CSS Modules
  - Function calls (clsx, classnames)
  - Angular class bindings and ngClass
  - Interpolation and dynamic classes

### Features
- **Multi-framework Support**: Works with both React and Angular projects
- **Real-time Analysis**: Automatic detection when files change
- **Visual Feedback**: Status bar indicators and problem panel warnings
- **Detailed Tooltips**: Rich hover information with file locations and suggestions
- **Performance Optimized**: Efficient parsing and analysis algorithms
- **Configurable**: Extensible pattern matching for different coding styles

### Technical Details
- Built with TypeScript for type safety
- Uses PostCSS for reliable CSS parsing
- Babel parser for accurate JSX/TSX analysis
- VS Code API integration for seamless user experience
- Comprehensive error handling and logging