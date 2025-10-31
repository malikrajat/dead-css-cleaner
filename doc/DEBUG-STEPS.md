# 🔍 DEBUG STEPS - Extension Not Detecting Unused CSS

## 🚨 **Issue**: Extension installed but not showing unused CSS warnings in Angular project

I've updated the extension with debug logging. Here's how to troubleshoot:

## 📋 **Step 1: Install Updated Extension**

```bash
# Install the updated version with debug logging
code --install-extension unused-css-detector-0.0.1.vsix
```

## 📋 **Step 2: Enable Debug Console**

1. **Open VS Code Developer Tools**:
   - Help → Toggle Developer Tools
   - Go to **Console** tab
   - Keep this open while testing

2. **Look for debug messages** starting with:
   ```
   [Unused CSS Detector] Found X CSS files, Y React files, Z Angular files
   [Unused CSS Detector] Processing Angular component: component.ts
   [Unused CSS Detector] Found N @Component decorators in component.ts
   ```

## 📋 **Step 3: Test with Your Angular Project**

### **Force Analysis**:
1. Open Command Palette (`Ctrl+Shift+P`)
2. Run **"Analyze Unused CSS"**
3. Watch the console for debug messages

### **Check Status Bar**:
- Bottom status bar should show:
  - `$(sync~spin) Analyzing CSS...` (during analysis)
  - `$(check) No unused CSS` or `$(warning) X unused selectors` (after analysis)

## 📋 **Step 4: Verify Your File Structure**

### **Required for Angular detection**:
```
your-angular-project/
├── src/
│   ├── app/
│   │   ├── component.ts        ← Must have @Component decorator
│   │   ├── component.html      ← Template file
│   │   └── component.css       ← CSS file
│   └── styles.css              ← Global styles
```

### **Example Angular Component** (component.ts):
```typescript
import { Component } from '@angular/core';

@Component({
  selector: 'app-example',
  templateUrl: './component.html',  // or template: '<div>...</div>'
  styleUrls: ['./component.css']    // CSS file reference
})
export class ExampleComponent {
  // component logic
}
```

### **Example CSS** (component.css):
```css
.used-class {
  color: blue;
}

.unused-class {
  color: red;  /* This should show as unused */
}
```

### **Example Template** (component.html):
```html
<div class="used-class">
  This class is used
</div>
<!-- .unused-class is not used here, so should show as warning -->
```

## 📋 **Step 5: Check Debug Output**

### **Expected Console Messages**:
```
[Unused CSS Detector] Found 1 CSS files, 0 React files, 1 Angular files
[Unused CSS Detector] Extracted 2 CSS selectors
[Unused CSS Detector] Processing Angular component: component.ts
[Unused CSS Detector] Found 1 @Component decorators in component.ts
[Unused CSS Detector] Found 1 used classes from React components
[Unused CSS Detector] Found 1 used classes from Angular components
```

### **If you see**:
- **"Found 0 Angular files"** → No .ts files found or they're excluded
- **"Skipping component.ts - not detected as Angular component"** → File doesn't have @Component decorator
- **"No @Component decorators found"** → Parsing issue with the component

## 📋 **Step 6: Common Issues & Solutions**

### **Issue 1: No Angular files detected**
**Debug message**: `Found X CSS files, Y React files, 0 Angular files`

**Solutions**:
- Ensure you have `.ts` files in your project
- Check if files are in excluded directories (node_modules, dist, etc.)
- Verify workspace is opened at correct level

### **Issue 2: Angular component not recognized**
**Debug message**: `Skipping component.ts - not detected as Angular component`

**Solutions**:
- Ensure file has `@Component(` decorator
- Check for syntax errors in the component file
- Verify imports are correct

### **Issue 3: No CSS selectors found**
**Debug message**: `Extracted 0 CSS selectors`

**Solutions**:
- Check if CSS files exist and have content
- Verify CSS file extensions (.css, .scss, .less)
- Check if CSS files are too large (>5MB limit)

### **Issue 4: Template not found**
**Debug message**: Look for file access errors

**Solutions**:
- Verify `templateUrl` path is correct relative to component
- Check if template file exists
- Ensure template file is readable

## 📋 **Step 7: Manual Test Case**

### **Create this test in your project**:

**test.component.ts**:
```typescript
import { Component } from '@angular/core';

@Component({
  selector: 'app-test',
  template: `
    <div class="used-class">Used class</div>
    <p class="another-used">Another used class</p>
  `,
  styleUrls: ['./test.component.css']
})
export class TestComponent { }
```

**test.component.css**:
```css
.used-class {
  color: blue;
}

.another-used {
  font-weight: bold;
}

.completely-unused {
  background: red;
}

.also-unused {
  margin: 10px;
}
```

**Expected result**:
- Status bar: "2 unused CSS selectors"
- Problems panel: Warnings for `.completely-unused` and `.also-unused`

## 📋 **Step 8: Check Extension Settings**

### **Verify these settings**:
```json
{
  "unusedCssDetector.autoAnalyze": true,
  "unusedCssDetector.showStatusBar": true,
  "unusedCssDetector.showNotifications": true,
  "unusedCssDetector.minFilesForAnalysis": 1,
  "unusedCssDetector.includeFileTypes": [".css", ".scss", ".less"],
  "unusedCssDetector.componentFileTypes": [".jsx", ".tsx", ".ts", ".js"]
}
```

## 📋 **Step 9: If Still Not Working**

### **Provide this debug info**:
1. **Console output** from Developer Tools
2. **File structure** of your Angular project
3. **Sample component file** content
4. **Sample CSS file** content
5. **Extension settings** from VS Code settings

### **Try this**:
1. Restart VS Code completely
2. Open your Angular project
3. Run manual analysis
4. Check console output
5. Report what you see

## 🎯 **Most Likely Issues**

1. **@Component decorator missing or malformed**
2. **CSS files in excluded directories**
3. **Template path incorrect in templateUrl**
4. **Extension not activating properly**

The debug version will help us identify exactly what's happening! 🔍