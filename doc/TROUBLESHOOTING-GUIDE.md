# 🔍 Troubleshooting Guide - Extension Not Detecting Unused CSS

## 🚨 **Issue**: Extension installed but not showing unused CSS warnings

Let's debug this step by step:

## 📋 **Step 1: Verify Extension is Active**

### **Check if extension is loaded**:
1. Open VS Code Command Palette (`Ctrl+Shift+P`)
2. Type "Unused CSS Detector"
3. You should see these commands:
   - ✅ "Analyze Unused CSS"
   - ✅ "Show Analysis Errors"
   - ✅ "Clear Error Log"

### **Check status bar**:
- Look at the bottom status bar
- You should see either:
  - `$(check) No unused CSS` (green)
  - `$(warning) X unused CSS selectors` (red)
  - `$(sync~spin) Analyzing CSS...` (yellow, during analysis)

## 📋 **Step 2: Manual Analysis**

### **Force analysis**:
1. Open Command Palette (`Ctrl+Shift+P`)
2. Run "Analyze Unused CSS"
3. Check if any messages appear

### **Check for errors**:
1. Open Command Palette (`Ctrl+Shift+P`)
2. Run "Show Analysis Errors"
3. See if there are any error messages

## 📋 **Step 3: Verify File Structure**

### **For Angular projects, ensure you have**:
```
your-project/
├── src/
│   ├── app/
│   │   ├── component.ts     ← Angular component files
│   │   ├── component.html   ← Template files
│   │   └── styles.css       ← CSS files
│   └── styles.css           ← Global CSS
```

### **Check file extensions**:
- ✅ CSS files: `.css`, `.scss`, `.less`
- ✅ Angular components: `.ts` files with `@Component` decorator
- ✅ Templates: `.html` files

## 📋 **Step 4: Check Configuration**

### **Open VS Code Settings**:
1. Go to File > Preferences > Settings
2. Search for "Unused CSS Detector"
3. Verify these settings:

```json
{
  "unusedCssDetector.autoAnalyze": true,
  "unusedCssDetector.showStatusBar": true,
  "unusedCssDetector.showNotifications": true,
  "unusedCssDetector.minFilesForAnalysis": 1
}
```

## 📋 **Step 5: Test with Simple Example**

### **Create a test case**:

**1. Create `test.css`**:
```css
.used-class {
  color: blue;
}

.unused-class {
  color: red;
}
```

**2. Create `test.component.ts`**:
```typescript
import { Component } from '@angular/core';

@Component({
  selector: 'app-test',
  template: '<div class="used-class">Test</div>',
  styleUrls: ['./test.css']
})
export class TestComponent { }
```

**3. Expected result**:
- `.unused-class` should show as warning in Problems panel
- Status bar should show "1 unused CSS selector"

## 📋 **Step 6: Common Issues & Solutions**

### **Issue 1: Extension not activating**
**Symptoms**: No status bar item, no commands available
**Solutions**:
- Restart VS Code
- Check if extension is enabled in Extensions panel
- Try opening a `.ts` or `.css` file to trigger activation

### **Issue 2: No CSS files found**
**Symptoms**: Status bar shows "No unused CSS" but you have CSS files
**Solutions**:
- Check if CSS files are in excluded directories (`node_modules`, `dist`, etc.)
- Verify file extensions match configuration
- Check `unusedCssDetector.includeFileTypes` setting

### **Issue 3: Angular components not detected**
**Symptoms**: CSS shows as unused but is used in Angular components
**Solutions**:
- Ensure `.ts` files have `@Component` decorator
- Check if `templateUrl` paths are correct
- Verify template files exist and are readable

### **Issue 4: Analysis not running**
**Symptoms**: No analysis happening, no status updates
**Solutions**:
- Check `unusedCssDetector.autoAnalyze` is `true`
- Try manual analysis: Command Palette > "Analyze Unused CSS"
- Check minimum files setting: `unusedCssDetector.minFilesForAnalysis`

### **Issue 5: Files too large**
**Symptoms**: Some files not analyzed
**Solutions**:
- Extension skips files > 5MB (CSS) or > 2MB (components)
- Check "Show Analysis Errors" for file size warnings

## 📋 **Step 7: Debug Information**

### **Get debug info**:
1. Open Command Palette (`Ctrl+Shift+P`)
2. Run "Show Analysis Errors"
3. Look for error messages and file counts

### **Check VS Code Developer Console**:
1. Help > Toggle Developer Tools
2. Go to Console tab
3. Look for messages starting with `[Unused CSS Detector]`

## 📋 **Step 8: Force Refresh**

### **Clear cache and restart**:
1. Command Palette > "Clear Analysis Cache"
2. Command Palette > "Clear Error Log"
3. Restart VS Code
4. Open your Angular project
5. Command Palette > "Analyze Unused CSS"

## 🔧 **Advanced Debugging**

### **Enable verbose logging** (temporary debug version):

Add this to your VS Code settings temporarily:
```json
{
  "unusedCssDetector.showNotifications": true,
  "unusedCssDetector.autoAnalyze": true
}
```

### **Check workspace configuration**:
Look for `.vscode/settings.json` in your project that might override global settings.

## 📞 **If Still Not Working**

### **Provide this information**:
1. VS Code version
2. Extension version
3. Project structure (file tree)
4. Output from "Show Analysis Errors"
5. Any console errors from Developer Tools
6. Sample CSS and Angular component files

### **Quick test**:
Create the simple test case from Step 5 in a new folder and see if it works there.

## 🎯 **Most Common Solution**

**90% of issues are solved by**:
1. Restarting VS Code
2. Running manual analysis: Command Palette > "Analyze Unused CSS"
3. Checking that files are not in excluded directories
4. Ensuring minimum file count is met (default: 1 CSS file)

Try these first! 🚀