# 🔧 Customization Template

## Required Replacements in package.json

Before publishing, you MUST replace these placeholder values:

### 1. Publisher Information
```json
"publisher": "your-publisher-name"  // ← Replace with your VS Code marketplace publisher name
```

### 2. Author Information
```json
"author": {
  "name": "Your Name",              // ← Replace with your actual name
  "email": "your.email@example.com", // ← Replace with your email
  "url": "https://github.com/your-username" // ← Replace with your GitHub profile
}
```

### 3. Repository URLs (Replace ALL instances of "your-username")
```json
"homepage": "https://github.com/your-username/unused-css-detector#readme",
"repository": {
  "type": "git",
  "url": "https://github.com/your-username/unused-css-detector.git"
},
"bugs": {
  "url": "https://github.com/your-username/unused-css-detector/issues"
},
"badges": [
  {
    "url": "https://img.shields.io/github/license/your-username/unused-css-detector",
    "href": "https://github.com/your-username/unused-css-detector/blob/main/LICENSE"
  }
],
"sponsor": {
  "url": "https://github.com/sponsors/your-username"
}
```

### 4. Test Files (Replace in src/test/suite/extension.test.ts)
```typescript
assert.ok(vscode.extensions.getExtension('your-publisher-name.unused-css-detector'));
```

## Example Completed Values

Here's how it might look when properly filled out:

```json
{
  "publisher": "johnsmith-dev",
  "author": {
    "name": "John Smith",
    "email": "john.smith@example.com",
    "url": "https://github.com/johnsmith"
  },
  "homepage": "https://github.com/johnsmith/unused-css-detector#readme",
  "repository": {
    "type": "git",
    "url": "https://github.com/johnsmith/unused-css-detector.git"
  },
  "bugs": {
    "url": "https://github.com/johnsmith/unused-css-detector/issues"
  }
}
```

## Quick Find & Replace

Use your editor's find & replace feature:

1. **Find:** `your-publisher-name` **Replace:** `your-actual-publisher-name`
2. **Find:** `your-username` **Replace:** `your-github-username`
3. **Find:** `Your Name` **Replace:** `Your Actual Name`
4. **Find:** `your.email@example.com` **Replace:** `your-real-email@domain.com`

## Verification Checklist

- [ ] Publisher name matches your VS Code marketplace account
- [ ] All GitHub URLs point to your actual repository
- [ ] Author information is correct
- [ ] Email address is valid
- [ ] Test file references correct extension ID
- [ ] Badge URLs are correct
- [ ] Sponsor URL is correct (or remove if not using GitHub Sponsors)

## Optional Customizations

### Gallery Banner Color
Current: `#007ACC` (VS Code blue)
You can change to match your brand:
```json
"galleryBanner": {
  "color": "#your-hex-color",
  "theme": "dark"  // or "light"
}
```

### Categories
Current categories are good, but you can adjust:
```json
"categories": [
  "Linters",
  "Programming Languages", 
  "Other"
]
```

Available categories: Linters, Snippets, Programming Languages, Machine Learning, Data Science, Testing, Debuggers, Formatters, Keymaps, SCM Providers, Other, Extension Packs, Language Packs, Education, Visualization, Notebooks, Themes

### Keywords
Add more relevant keywords for better discoverability:
```json
"keywords": [
  "css", "unused", "react", "angular", "optimization", 
  "cleanup", "selectors", "performance", "bundle-size", 
  "dead-code", "webpack", "build-optimization", "frontend"
]
```