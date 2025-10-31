# Publishing Guide

## Prerequisites

1. **VS Code Publisher Account**
   - Create account at https://marketplace.visualstudio.com/manage
   - Get Personal Access Token from Azure DevOps

2. **Update package.json**
   - Replace `your-publisher-name` with your actual publisher name
   - Replace `your-username` with your GitHub username
   - Update author information

3. **Create Extension Icon**
   - Convert `icon.svg` to `icon.png` (128x128px)
   - Or create a custom PNG icon

## Steps to Publish

### 1. Install VSCE
```bash
npm install -g @vscode/vsce
```

### 2. Login to Publisher
```bash
vsce login your-publisher-name
```

### 3. Package Extension
```bash
npm run package
```

### 4. Test the Package
```bash
code --install-extension unused-css-detector-0.0.1.vsix
```

### 5. Publish to Marketplace
```bash
npm run publish
```

## Pre-Publication Checklist

- [ ] Update version in package.json
- [ ] Update CHANGELOG.md
- [ ] Replace placeholder publisher name
- [ ] Replace placeholder repository URLs
- [ ] Add real extension icon (icon.png)
- [ ] Add screenshots to images/ directory
- [ ] Test extension thoroughly
- [ ] Run all tests: `npm test`
- [ ] Run linting: `npm run lint`
- [ ] Package successfully: `npm run package`

## Version Management

Use semantic versioning:
- **Patch** (0.0.X): Bug fixes
- **Minor** (0.X.0): New features
- **Major** (X.0.0): Breaking changes

Update version:
```bash
npm version patch  # or minor, major
```

## Marketplace Guidelines

- Extension name must be unique
- Description should be clear and concise
- Include relevant keywords for discoverability
- Provide screenshots showing key features
- Write comprehensive README
- Include proper license
- Test on multiple platforms