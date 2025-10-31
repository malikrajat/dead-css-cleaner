# 🚨 Extension Not Loading - Troubleshooting Guide

## **Issue**: "Analyze Unused CSS" command not found in Command Palette

This means the extension is not properly activated. Let's fix this step by step.

## 📋 **Step 1: Check Extension Installation**

### **Verify extension is installed**:
1. Open VS Code
2. Go to Extensions panel (`Ctrl+Shift+X`)
3. Search for "Unused CSS Detector" or look in "Installed" section
4. You should see the extension listed

### **If not found**:
- The extension might not be installed properly
- Try reinstalling: `code --install-extension unused-css-detector-0.0.1.vsix`

## 📋 **Step 2: Check Extension Status**

### **Look for extension in Extensions panel**:
- **Green checkmark** = Enabled and active
- **Yellow warning** = Installed but disabled
- **Red X** = Error loading

### **If disabled**:
- Click on the extension
- Click "Enable" button

### **If error**:
- Click on the extension
- Look for error messages
- Try "Reload" or restart VS Code

## 📋 **Step 3: Check Activation Events**

### **Extension should activate when you open**:
- `.css` files
- `.scss` files  
- `.less` files
- `.ts` files (TypeScript)
- `.js` files (JavaScript)

### **Test activation**:
1. Open a `.css` or `.ts` file in your workspace
2. Wait 2-3 seconds
3. Try Command Palette again

## 📋 **Step 4: Force Extension Activation**

### **Method 1: Open relevant files**:
```
1. Open any .css file
2. Open any .ts file (Angular component)
3. Wait a few seconds
4. Try Command Palette → "Analyze Unused CSS"
```

### **Method 2: Reload VS Code**:
```
1. Command Palette (Ctrl+Shift+P)
2. Type "Developer: Reload Window"
3. Press Enter
4. Try Command Palette → "Analyze Unused CSS"
```

## 📋 **Step 5: Check Developer Console for Errors**

### **Open Developer Tools**:
1. Help → Toggle Developer Tools
2. Go to **Console** tab
3. Look for error messages related to "unused-css-detector"

### **Common errors**:
- Module loading errors
- Dependency issues
- Activation failures

## 📋 **Step 6: Verify File Structure**

### **Check if extension files exist**:
The extension should be installed in VS Code's extensions folder. The main file should be:
```
~/.vscode/extensions/your-publisher-name.unused-css-detector-0.0.1/out/extension.js
```

## 📋 **Step 7: Alternative Command Search**

### **Try searching for**:
- "Unused CSS" (partial match)
- "CSS Detector" (partial match)
- "Analyze" (partial match)

### **Look for category**:
- Commands should appear under "Unused CSS Detector" category

## 📋 **Step 8: Check Workspace Requirements**

### **Extension requires**:
- A workspace to be open (not just single files)
- Files with supported extensions (.css, .ts, etc.)

### **Try this**:
1. Open a folder/workspace (File → Open Folder)
2. Ensure the folder contains .css and .ts files
3. Try Command Palette again

## 📋 **Step 9: Manual Installation Check**

### **Verify installation location**:
```bash
# Check if extension is installed
code --list-extensions | grep unused-css
```

### **If not listed**:
```bash
# Reinstall the extension
code --install-extension unused-css-detector-0.0.1.vsix --force
```

## 📋 **Step 10: Create Test Environment**

### **Create a minimal test case**:

**1. Create new folder**: `test-extension`

**2. Create `test.css`**:
```css
.used-class {
  color: blue;
}

.unused-class {
  color: red;
}
```

**3. Create `test.component.ts`**:
```typescript
import { Component } from '@angular/core';

@Component({
  selector: 'app-test',
  template: '<div class="used-class">Test</div>',
  styleUrls: ['./test.css']
})
export class TestComponent { }
```

**4. Open this folder in VS Code**:
```bash
code test-extension
```

**5. Try Command Palette** → "Analyze Unused CSS"

## 🔧 **Advanced Troubleshooting**

### **Check VS Code version**:
- Extension requires VS Code 1.74.0 or higher
- Help → About to check version

### **Check Node.js version**:
- Extension requires Node.js 16.0.0 or higher
- `node --version` in terminal

### **Reset VS Code extensions**:
```bash
# Disable all extensions
code --disable-extensions

# Enable only our extension
code --enable-extension unused-css-detector
```

## 🚨 **If Still Not Working**

### **Try complete reinstall**:
```bash
# Uninstall
code --uninstall-extension unused-css-detector

# Reinstall
code --install-extension unused-css-detector-0.0.1.vsix

# Restart VS Code completely
```

### **Check extension logs**:
1. Help → Toggle Developer Tools
2. Console tab
3. Look for any error messages when VS Code starts

### **Alternative: Install from different location**:
```bash
# Try installing with full path
code --install-extension "C:\full\path\to\unused-css-detector-0.0.1.vsix"
```

## 📞 **Report Back**

### **Please provide**:
1. **VS Code version** (Help → About)
2. **Extension panel status** (enabled/disabled/error)
3. **Console errors** (if any)
4. **Operating system**
5. **Whether you have a workspace open**

### **Quick test**:
1. Restart VS Code completely
2. Open a folder with .css and .ts files
3. Open a .ts file
4. Wait 5 seconds
5. Try Command Palette → search "unused"

**The extension should appear if it's properly installed and activated!** 🔍

## 🎯 **Most Common Solutions**

**90% of "command not found" issues are solved by**:
1. **Restarting VS Code** completely
2. **Opening a workspace** (not just single files)
3. **Opening a .ts or .css file** to trigger activation
4. **Waiting a few seconds** for activation to complete

Try these first! 🚀