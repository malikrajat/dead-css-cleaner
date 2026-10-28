# 🛡️ Error Handling & Recovery

## Comprehensive Error Handling System

The Unused CSS Detector extension includes a robust error handling system that gracefully manages various types of failures and provides helpful feedback to users.

## Error Types

### 1. **CSS Parse Errors** (`css-parse`)
**What it handles:**
- Malformed CSS/SCSS/LESS syntax
- Invalid selectors
- Corrupted CSS files
- Files that appear to be CSS but contain invalid content

**Recovery actions:**
- Skips problematic files and continues analysis
- Validates file content before parsing
- Provides specific error messages for common issues
- Offers troubleshooting suggestions

**Example scenarios:**
- CSS file with missing closing braces
- SCSS file with invalid nesting
- Binary file with .css extension

### 2. **React Parse Errors** (`react-parse`)
**What it handles:**
- JSX/TSX syntax errors
- Invalid React component structure
- TypeScript compilation issues
- Missing imports or dependencies

**Recovery actions:**
- Enables error recovery mode in Babel parser
- Validates React content before parsing
- Continues processing other components
- Provides syntax-specific error messages

**Example scenarios:**
- JSX with unclosed tags
- TypeScript errors in component files
- Invalid className expressions

### 3. **Angular Parse Errors** (`angular-parse`)
**What it handles:**
- Invalid @Component decorator syntax
- Template file access issues
- TypeScript syntax errors
- Missing template files

**Recovery actions:**
- Validates Angular component structure
- Checks template file existence
- Gracefully handles missing templates
- Continues with other components

**Example scenarios:**
- Malformed @Component decorator
- Missing template file referenced by templateUrl
- Invalid TypeScript syntax

### 4. **File Access Errors** (`file-access`)
**What it handles:**
- Missing files
- Permission denied errors
- Files that are too large
- Network drive access issues

**Recovery actions:**
- Checks file existence before processing
- Validates file permissions
- Implements file size limits
- Provides clear error messages

**Example scenarios:**
- Deleted files still referenced in workspace
- Files on network drives that are temporarily unavailable
- Very large files that could cause performance issues

### 5. **Configuration Errors** (`configuration`)
**What it handles:**
- Invalid extension settings
- Malformed glob patterns
- Out-of-range numeric values
- Missing required configuration

**Recovery actions:**
- Validates all configuration values
- Provides default values for invalid settings
- Shows specific configuration error messages
- Links to settings page for fixes

**Example scenarios:**
- Invalid exclude patterns
- Negative debounce delays
- Empty file type arrays

### 6. **General Errors** (`general`)
**What it handles:**
- Unexpected runtime errors
- Memory issues
- VS Code API failures
- Network connectivity problems

**Recovery actions:**
- Logs detailed error information
- Provides fallback behavior
- Shows user-friendly error messages
- Suggests recovery actions

## Error Recovery Features

### 🔄 **Graceful Degradation**
- Analysis continues even when individual files fail
- Partial results are still useful and displayed
- Extension remains functional after errors

### 📊 **Error Tracking**
- Maintains error log for current session
- Categorizes errors by type
- Provides error statistics and summaries

### 🔍 **Detailed Error Information**
- File-specific error details
- Line numbers and context when available
- Troubleshooting suggestions
- Links to relevant documentation

### ⚡ **Performance Protection**
- File size limits prevent memory issues
- Timeout protection for long operations
- Resource cleanup after errors

## User Interface Features

### 📱 **Smart Notifications**
- Configurable notification levels
- Context-aware error messages
- Action buttons for common fixes
- Summary notifications for batch operations

### 🛠️ **Error Management Commands**
- **Show Analysis Errors**: View detailed error summary
- **Clear Error Log**: Reset error tracking
- **Analyze Unused CSS**: Retry analysis after fixes

### 📋 **Error Details View**
- Markdown-formatted error reports
- Categorized error listings
- Troubleshooting guides
- Timestamp information

## Configuration Options

### Error Handling Settings
```json
{
  "unusedCssDetector.showNotifications": true,
  "unusedCssDetector.excludePatterns": [
    "**/problematic-files/**"
  ]
}
```

### Performance Settings
```json
{
  "unusedCssDetector.debounceDelay": 1000,
  "unusedCssDetector.minFilesForAnalysis": 3
}
```

## Troubleshooting Guide

### Common Issues and Solutions

#### **CSS Parse Failures**
1. **Check file syntax** - Validate CSS/SCSS/LESS syntax
2. **Exclude problematic files** - Add to excludePatterns
3. **Check file encoding** - Ensure UTF-8 encoding
4. **Verify file extensions** - Match actual content type

#### **Component Parse Failures**
1. **Fix syntax errors** - Check JSX/TSX/TS syntax
2. **Update dependencies** - Ensure React/Angular versions are compatible
3. **Check imports** - Verify all imports are available
4. **Exclude test files** - Add test directories to excludePatterns

#### **File Access Issues**
1. **Check permissions** - Ensure files are readable
2. **Verify paths** - Check for broken symlinks
3. **Network drives** - Consider local copies for better performance
4. **File locks** - Close files in other applications

#### **Performance Issues**
1. **Increase debounce delay** - Reduce analysis frequency
2. **Exclude large directories** - Add build/dist folders to excludePatterns
3. **Increase minimum file threshold** - Skip analysis for small projects
4. **Disable auto-analysis** - Use manual analysis for large projects

## Best Practices

### For Extension Users
- Review error summaries regularly
- Configure appropriate exclude patterns
- Keep files in valid syntax
- Use reasonable file size limits

### For Large Projects
- Increase debounce delays
- Exclude build directories
- Use workspace-specific settings
- Monitor error logs for patterns

### For Development Teams
- Establish coding standards
- Use linting tools
- Regular syntax validation
- Document known issues

## Error Prevention

### File Organization
- Keep CSS and component files in organized structure
- Use consistent naming conventions
- Avoid deeply nested directories
- Separate source from build files

### Code Quality
- Use linting tools (ESLint, Stylelint)
- Validate syntax before committing
- Use TypeScript for better error detection
- Regular code reviews

### Configuration Management
- Use workspace settings for team consistency
- Document project-specific configurations
- Regular configuration reviews
- Version control for settings

## Recovery Strategies

### Immediate Actions
1. Check error summary for patterns
2. Fix obvious syntax errors
3. Exclude problematic files temporarily
4. Restart analysis

### Long-term Solutions
1. Improve code quality processes
2. Update tooling and dependencies
3. Establish error monitoring
4. Team training on best practices

The error handling system ensures that the Unused CSS Detector remains reliable and helpful even when working with imperfect codebases, providing clear guidance for resolving issues while maintaining functionality.