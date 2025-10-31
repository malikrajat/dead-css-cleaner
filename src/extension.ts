import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { parse as parseCSS } from 'postcss';
import selectorParser from 'postcss-selector-parser';
import { parse as parseBabel } from '@babel/parser';
import traverse from '@babel/traverse';
import * as t from '@babel/types';

interface CSSSelector {
    selector: string;
    file: string;
    line: number;
    column: number;
}

interface UsedClass {
    className: string;
    file: string;
}

interface AngularComponent {
    file: string;
    templateUrl?: string;
    template?: string;
    styleUrls: string[];
}

let statusBarItem: vscode.StatusBarItem;
let debounceTimer: NodeJS.Timeout | undefined;

// Error handling and logging
interface AnalysisError {
    type: 'css-parse' | 'react-parse' | 'angular-parse' | 'file-access' | 'configuration' | 'general';
    file?: string;
    message: string;
    details?: string;
    recoverable: boolean;
}

class ErrorHandler {
    private static errors: AnalysisError[] = [];
    private static readonly MAX_ERRORS = 50;

    static logError(error: AnalysisError) {
        this.errors.unshift(error);
        if (this.errors.length > this.MAX_ERRORS) {
            this.errors = this.errors.slice(0, this.MAX_ERRORS);
        }
        
        console.error(`[Unused CSS Detector] ${error.type}: ${error.message}`, error.details || '');
        
        // Show user-friendly messages for critical errors
        if (!error.recoverable) {
            this.showUserError(error);
        }
    }

    static showUserError(error: AnalysisError) {
        const config = getConfiguration();
        if (!config.showNotifications) {
            return;
        }

        let message = '';
        let actions: string[] = [];

        switch (error.type) {
            case 'css-parse':
                message = `CSS parsing failed in ${path.basename(error.file || 'unknown file')}`;
                actions = ['View Details', 'Ignore'];
                break;
            case 'react-parse':
                message = `React component parsing failed in ${path.basename(error.file || 'unknown file')}`;
                actions = ['View Details', 'Ignore'];
                break;
            case 'angular-parse':
                message = `Angular component parsing failed in ${path.basename(error.file || 'unknown file')}`;
                actions = ['View Details', 'Ignore'];
                break;
            case 'file-access':
                message = `Cannot access file: ${path.basename(error.file || 'unknown file')}`;
                actions = ['Retry', 'Ignore'];
                break;
            case 'configuration':
                message = `Configuration error: ${error.message}`;
                actions = ['Open Settings', 'Ignore'];
                break;
            default:
                message = `Analysis error: ${error.message}`;
                actions = ['View Details'];
        }

        vscode.window.showWarningMessage(message, ...actions).then(action => {
            if (action === 'View Details') {
                this.showErrorDetails(error);
            } else if (action === 'Open Settings') {
                vscode.commands.executeCommand('workbench.action.openSettings', 'unusedCssDetector');
            } else if (action === 'Retry') {
                vscode.commands.executeCommand('unusedCssDetector.analyze');
            }
        });
    }

    static showErrorDetails(error: AnalysisError) {
        const details = `
Error Type: ${error.type}
File: ${error.file || 'N/A'}
Message: ${error.message}
Details: ${error.details || 'No additional details'}
Recoverable: ${error.recoverable ? 'Yes' : 'No'}
Time: ${new Date().toLocaleString()}

Troubleshooting:
${this.getTroubleshootingTips(error.type)}
        `.trim();

        vscode.workspace.openTextDocument({
            content: details,
            language: 'plaintext'
        }).then(doc => {
            vscode.window.showTextDocument(doc);
        });
    }

    static getTroubleshootingTips(errorType: string): string {
        switch (errorType) {
            case 'css-parse':
                return `• Check for syntax errors in your CSS file
• Ensure the file uses valid CSS/SCSS/LESS syntax
• Try excluding the problematic file using excludePatterns setting`;
            case 'react-parse':
                return `• Check for syntax errors in your React component
• Ensure valid JSX/TSX syntax
• Check for missing imports or type definitions`;
            case 'angular-parse':
                return `• Check for syntax errors in your Angular component
• Ensure valid TypeScript syntax
• Verify @Component decorator syntax`;
            case 'file-access':
                return `• Check file permissions
• Ensure the file exists and is readable
• Try restarting VS Code`;
            case 'configuration':
                return `• Check your extension settings
• Reset to default configuration if needed
• Ensure glob patterns are valid`;
            default:
                return `• Try restarting VS Code
• Check the extension output panel for more details
• Report the issue if it persists`;
        }
    }

    static getErrorSummary(): { total: number; byType: Record<string, number> } {
        const byType: Record<string, number> = {};
        this.errors.forEach(error => {
            byType[error.type] = (byType[error.type] || 0) + 1;
        });
        return { total: this.errors.length, byType };
    }

    static clearErrors() {
        this.errors = [];
    }
}

interface ExtensionConfig {
    autoAnalyze: boolean;
    excludePatterns: string[];
    includeFileTypes: string[];
    componentFileTypes: string[];
    showStatusBar: boolean;
    showNotifications: boolean;
    minFilesForAnalysis: number;
    debounceDelay: number;
}

function getConfiguration(): ExtensionConfig {
    const config = vscode.workspace.getConfiguration('unusedCssDetector');
    return {
        autoAnalyze: config.get('autoAnalyze', true),
        excludePatterns: config.get('excludePatterns', ['**/node_modules/**', '**/dist/**', '**/build/**', '**/.git/**']),
        includeFileTypes: config.get('includeFileTypes', ['.css', '.scss', '.less']),
        componentFileTypes: config.get('componentFileTypes', ['.jsx', '.tsx', '.ts', '.js']),
        showStatusBar: config.get('showStatusBar', true),
        showNotifications: config.get('showNotifications', true),
        minFilesForAnalysis: config.get('minFilesForAnalysis', 1),
        debounceDelay: config.get('debounceDelay', 500)
    };
}

export function activate(context: vscode.ExtensionContext) {
    const diagnosticCollection = vscode.languages.createDiagnosticCollection('unused-css');
    
    // Create status bar item (conditionally)
    const config = getConfiguration();
    if (config.showStatusBar) {
        statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        statusBarItem.command = 'unusedCssDetector.analyze';
        statusBarItem.tooltip = 'Click to analyze unused CSS selectors';
        statusBarItem.show();
        context.subscriptions.push(statusBarItem);
    }
    
    context.subscriptions.push(diagnosticCollection);

    // Register commands
    const analyzeCommand = vscode.commands.registerCommand('unusedCssDetector.analyze', () => {
        analyzeUnusedCSS(diagnosticCollection);
    });

    const showErrorsCommand = vscode.commands.registerCommand('unusedCssDetector.showErrors', () => {
        showErrorSummary();
    });

    const clearErrorsCommand = vscode.commands.registerCommand('unusedCssDetector.clearErrors', () => {
        ErrorHandler.clearErrors();
        vscode.window.showInformationMessage('Error log cleared');
    });

    // Debounced analysis function
    const debouncedAnalyze = (diagnosticCollection: vscode.DiagnosticCollection) => {
        const currentConfig = getConfiguration();
        
        if (debounceTimer) {
            clearTimeout(debounceTimer);
        }
        
        debounceTimer = setTimeout(() => {
            analyzeUnusedCSS(diagnosticCollection);
        }, currentConfig.debounceDelay);
    };

    // Auto-analyze on file save (conditionally)
    const onSaveHandler = vscode.workspace.onDidSaveTextDocument((document: vscode.TextDocument) => {
        const currentConfig = getConfiguration();
        if (currentConfig.autoAnalyze && isRelevantFile(document.fileName, currentConfig)) {
            debouncedAnalyze(diagnosticCollection);
        }
    });

    // Auto-analyze on file open (conditionally)
    const onOpenHandler = vscode.window.onDidChangeActiveTextEditor(() => {
        const currentConfig = getConfiguration();
        if (currentConfig.autoAnalyze) {
            debouncedAnalyze(diagnosticCollection);
        }
    });

    // Listen for configuration changes
    const onConfigChange = vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('unusedCssDetector')) {
            const newConfig = getConfiguration();
            
            // Handle status bar visibility changes
            if (newConfig.showStatusBar && !statusBarItem) {
                statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
                statusBarItem.command = 'unusedCssDetector.analyze';
                statusBarItem.tooltip = 'Click to analyze unused CSS selectors';
                statusBarItem.show();
                context.subscriptions.push(statusBarItem);
            } else if (!newConfig.showStatusBar && statusBarItem) {
                statusBarItem.dispose();
                statusBarItem = undefined as any;
            }
            
            // Re-analyze with new settings
            if (newConfig.autoAnalyze) {
                analyzeUnusedCSS(diagnosticCollection);
            }
        }
    });

    context.subscriptions.push(analyzeCommand, showErrorsCommand, clearErrorsCommand, onSaveHandler, onOpenHandler, onConfigChange);

    // Initial analysis (conditionally)
    if (config.showStatusBar) {
        updateStatusBar(0);
    }
    if (config.autoAnalyze) {
        analyzeUnusedCSS(diagnosticCollection);
    }
}

function isRelevantFile(fileName: string, config?: ExtensionConfig): boolean {
    const currentConfig = config || getConfiguration();
    const ext = path.extname(fileName);
    const allRelevantTypes = [...currentConfig.includeFileTypes, ...currentConfig.componentFileTypes];
    return allRelevantTypes.includes(ext);
}

async function analyzeUnusedCSS(diagnosticCollection: vscode.DiagnosticCollection) {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        updateStatusBar(0);
        return;
    }

    diagnosticCollection.clear();
    updateStatusBar(0, true); // Show analyzing state

    let totalUnusedSelectors = 0;

    for (const folder of workspaceFolders) {
        const unusedCount = await analyzeWorkspaceFolder(folder.uri.fsPath, diagnosticCollection);
        totalUnusedSelectors += unusedCount;
    }

    updateStatusBar(totalUnusedSelectors);
}

async function analyzeWorkspaceFolder(workspacePath: string, diagnosticCollection: vscode.DiagnosticCollection): Promise<number> {
    try {
        // Clear previous errors for new analysis
        ErrorHandler.clearErrors();
        
        const config = getConfiguration();
        
        // Validate configuration
        if (!validateConfiguration(config)) {
            return 0;
        }

        // Find all CSS and component files using configuration
        let cssFiles: string[] = [];
        let componentFiles: string[] = [];
        
        try {
            cssFiles = await findFiles(workspacePath, config.includeFileTypes, config);
            componentFiles = await findFiles(workspacePath, config.componentFileTypes, config);
        } catch (fileError) {
            ErrorHandler.logError({
                type: 'file-access',
                message: 'Failed to scan workspace files',
                details: String(fileError),
                recoverable: false
            });
            return 0;
        }

        // Check minimum files requirement
        if (cssFiles.length < config.minFilesForAnalysis) {
            if (config.showNotifications) {
                vscode.window.showInformationMessage(
                    `Skipping analysis: Found ${cssFiles.length} CSS file(s), minimum required: ${config.minFilesForAnalysis}`
                );
            }
            return 0;
        }
        
        // Separate React and Angular files
        const reactFiles = componentFiles.filter(file => ['.jsx', '.tsx'].includes(path.extname(file)));
        const angularFiles = componentFiles.filter(file => ['.ts'].includes(path.extname(file)));

        // Show progress for large projects
        const totalFiles = cssFiles.length + reactFiles.length + angularFiles.length;
        if (totalFiles > 50 && config.showNotifications) {
            vscode.window.showInformationMessage(
                `Analyzing ${totalFiles} files... This may take a moment.`
            );
        }

        // Parse CSS selectors with error handling
        console.log(`[Unused CSS Detector] Found ${cssFiles.length} CSS files, ${reactFiles.length} React files, ${angularFiles.length} Angular files`);
        const cssSelectors = await parseCSSFiles(cssFiles);
        console.log(`[Unused CSS Detector] Extracted ${cssSelectors.length} CSS selectors`);
        
        // Parse React components for used classes
        const reactUsedClasses = await parseReactComponents(reactFiles);
        console.log(`[Unused CSS Detector] Found ${reactUsedClasses.length} used classes from React components`);
        
        // Parse Angular components for used classes
        const angularUsedClasses = await parseAngularComponents(angularFiles, workspacePath);
        console.log(`[Unused CSS Detector] Found ${angularUsedClasses.length} used classes from Angular components`);

        // Combine all used classes
        const allUsedClasses = [...reactUsedClasses, ...angularUsedClasses];

        // Find unused selectors
        const unusedSelectors = findUnusedSelectors(cssSelectors, allUsedClasses);

        // Create diagnostics with enhanced tooltips
        createDiagnosticsWithTooltips(unusedSelectors, diagnosticCollection, cssFiles.length, reactFiles.length, angularFiles.length, config);

        // Show analysis summary
        const errorSummary = ErrorHandler.getErrorSummary();
        if (config.showNotifications && errorSummary.total === 0) {
            const message = unusedSelectors.length === 0 
                ? `✅ Analysis complete: All ${cssSelectors.length} CSS selectors are in use`
                : `⚠️ Analysis complete: Found ${unusedSelectors.length} unused selectors out of ${cssSelectors.length} total`;
            
            if (totalFiles > 20) { // Only show for larger projects
                vscode.window.showInformationMessage(message);
            }
        }

        return unusedSelectors.length;

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        
        ErrorHandler.logError({
            type: 'general',
            message: 'Critical error during CSS analysis',
            details: errorMessage,
            recoverable: false
        });
        
        return 0;
    }
}

function validateConfiguration(config: ExtensionConfig): boolean {
    // Validate file type arrays
    if (!Array.isArray(config.includeFileTypes) || config.includeFileTypes.length === 0) {
        ErrorHandler.logError({
            type: 'configuration',
            message: 'includeFileTypes must be a non-empty array',
            recoverable: false
        });
        return false;
    }

    if (!Array.isArray(config.componentFileTypes) || config.componentFileTypes.length === 0) {
        ErrorHandler.logError({
            type: 'configuration',
            message: 'componentFileTypes must be a non-empty array',
            recoverable: false
        });
        return false;
    }

    // Validate numeric values
    if (config.minFilesForAnalysis < 1) {
        ErrorHandler.logError({
            type: 'configuration',
            message: 'minFilesForAnalysis must be at least 1',
            recoverable: false
        });
        return false;
    }

    if (config.debounceDelay < 0 || config.debounceDelay > 10000) {
        ErrorHandler.logError({
            type: 'configuration',
            message: 'debounceDelay must be between 0 and 10000 milliseconds',
            recoverable: false
        });
        return false;
    }

    // Validate exclude patterns
    if (!Array.isArray(config.excludePatterns)) {
        ErrorHandler.logError({
            type: 'configuration',
            message: 'excludePatterns must be an array',
            recoverable: false
        });
        return false;
    }

    return true;
}

async function findFiles(workspacePath: string, extensions: string[], config: ExtensionConfig): Promise<string[]> {
    const searchPattern = `**/*{${extensions.join(',')}}`;
    const excludePattern = `{${config.excludePatterns.join(',')}}`;
    const uris = await vscode.workspace.findFiles(searchPattern, excludePattern);
    
    return uris.map((uri: vscode.Uri) => uri.fsPath);
}

async function parseCSSFiles(cssFiles: string[]): Promise<CSSSelector[]> {
    const selectors: CSSSelector[] = [];
    let successfulFiles = 0;
    let failedFiles = 0;

    for (const file of cssFiles) {
        try {
            // Check file accessibility
            if (!fs.existsSync(file)) {
                ErrorHandler.logError({
                    type: 'file-access',
                    file,
                    message: 'File does not exist',
                    recoverable: true
                });
                failedFiles++;
                continue;
            }

            // Check file size (skip very large files)
            const stats = fs.statSync(file);
            if (stats.size > 5 * 1024 * 1024) { // 5MB limit
                ErrorHandler.logError({
                    type: 'css-parse',
                    file,
                    message: 'File too large (>5MB), skipping for performance',
                    recoverable: true
                });
                failedFiles++;
                continue;
            }

            const content = fs.readFileSync(file, 'utf8');
            
            // Basic validation - check if file is empty or has suspicious content
            if (!content.trim()) {
                continue; // Skip empty files silently
            }

            // Validate basic CSS structure
            if (!isValidCSSContent(content)) {
                ErrorHandler.logError({
                    type: 'css-parse',
                    file,
                    message: 'File does not appear to contain valid CSS',
                    details: 'File may be corrupted or in wrong format',
                    recoverable: true
                });
                failedFiles++;
                continue;
            }

            const ast = parseCSS(content, { from: file });

            ast.walkRules((rule: any) => {
                try {
                    rule.selectors.forEach((selector: string) => {
                        try {
                            // Parse selector to extract class and id names
                            selectorParser((selectorAST: any) => {
                                selectorAST.walkClasses((classNode: any) => {
                                    if (classNode.value && typeof classNode.value === 'string') {
                                        selectors.push({
                                            selector: `.${classNode.value}`,
                                            file,
                                            line: rule.source?.start?.line || 0,
                                            column: rule.source?.start?.column || 0
                                        });
                                    }
                                });
                                
                                selectorAST.walkIds((idNode: any) => {
                                    if (idNode.value && typeof idNode.value === 'string') {
                                        selectors.push({
                                            selector: `#${idNode.value}`,
                                            file,
                                            line: rule.source?.start?.line || 0,
                                            column: rule.source?.start?.column || 0
                                        });
                                    }
                                });
                            }).processSync(selector);
                        } catch (selectorError) {
                            ErrorHandler.logError({
                                type: 'css-parse',
                                file,
                                message: `Failed to parse selector: ${selector}`,
                                details: String(selectorError),
                                recoverable: true
                            });
                        }
                    });
                } catch (ruleError) {
                    ErrorHandler.logError({
                        type: 'css-parse',
                        file,
                        message: 'Failed to process CSS rule',
                        details: String(ruleError),
                        recoverable: true
                    });
                }
            });
            
            successfulFiles++;
        } catch (error) {
            failedFiles++;
            const errorMessage = error instanceof Error ? error.message : String(error);
            
            ErrorHandler.logError({
                type: 'css-parse',
                file,
                message: 'Failed to parse CSS file',
                details: errorMessage,
                recoverable: true
            });
        }
    }

    // Log summary if there were issues
    if (failedFiles > 0) {
        const config = getConfiguration();
        if (config.showNotifications) {
            vscode.window.showWarningMessage(
                `CSS Analysis: ${successfulFiles} files processed successfully, ${failedFiles} files failed. Click for details.`,
                'View Details'
            ).then(action => {
                if (action === 'View Details') {
                    const summary = ErrorHandler.getErrorSummary();
                    vscode.window.showInformationMessage(
                        `Error Summary: ${summary.total} total errors. CSS Parse: ${summary.byType['css-parse'] || 0}, File Access: ${summary.byType['file-access'] || 0}`
                    );
                }
            });
        }
    }

    return selectors;
}

function isValidCSSContent(content: string): boolean {
    // Basic CSS validation - check for common CSS patterns
    const cssPatterns = [
        /\{[^}]*\}/,  // CSS rules with braces
        /@[a-zA-Z-]+/,  // At-rules like @media, @import
        /[.#][a-zA-Z0-9_-]+/,  // Class or ID selectors
        /[a-zA-Z-]+\s*:/  // CSS properties
    ];
    
    return cssPatterns.some(pattern => pattern.test(content));
}

async function parseReactComponents(reactFiles: string[]): Promise<UsedClass[]> {
    const usedClasses: UsedClass[] = [];
    let successfulFiles = 0;
    let failedFiles = 0;

    for (const file of reactFiles) {
        try {
            // Check file accessibility and size
            if (!fs.existsSync(file)) {
                ErrorHandler.logError({
                    type: 'file-access',
                    file,
                    message: 'React component file does not exist',
                    recoverable: true
                });
                failedFiles++;
                continue;
            }

            const stats = fs.statSync(file);
            if (stats.size > 2 * 1024 * 1024) { // 2MB limit for component files
                ErrorHandler.logError({
                    type: 'react-parse',
                    file,
                    message: 'Component file too large (>2MB), skipping for performance',
                    recoverable: true
                });
                failedFiles++;
                continue;
            }

            const content = fs.readFileSync(file, 'utf8');
            
            if (!content.trim()) {
                continue; // Skip empty files silently
            }

            // Basic validation for React/JSX content
            if (!isValidReactContent(content)) {
                ErrorHandler.logError({
                    type: 'react-parse',
                    file,
                    message: 'File does not appear to contain valid React/JSX content',
                    recoverable: true
                });
                failedFiles++;
                continue;
            }

            // Determine appropriate plugins based on file extension
            const plugins: any[] = ['jsx', 'objectRestSpread'];
            if (file.endsWith('.tsx') || file.endsWith('.ts')) {
                plugins.push('typescript');
            }
            plugins.push('decorators-legacy', 'classProperties');

            // Parse with Babel
            const ast = parseBabel(content, {
                sourceType: 'module',
                plugins,
                errorRecovery: true // Enable error recovery
            });

            // Traverse AST to find className and id attributes
            traverse(ast, {
                JSXAttribute(path: any) {
                    try {
                        const name = path.node.name;
                        if (t.isJSXIdentifier(name) && (name.name === 'className' || name.name === 'id')) {
                            const value = path.node.value;
                            
                            if (t.isStringLiteral(value)) {
                                // Static string: className="btn primary"
                                const classes = value.value.split(/\s+/).filter(Boolean);
                                classes.forEach((className: string) => {
                                    if (isValidClassName(className)) {
                                        usedClasses.push({ className, file });
                                    }
                                });
                            } else if (t.isJSXExpressionContainer(value)) {
                                // Expression: className={styles.button}
                                try {
                                    extractClassesFromExpression(value.expression, usedClasses, file);
                                } catch (extractError) {
                                    ErrorHandler.logError({
                                        type: 'react-parse',
                                        file,
                                        message: 'Failed to extract classes from expression',
                                        details: String(extractError),
                                        recoverable: true
                                    });
                                }
                            }
                        }
                    } catch (attrError) {
                        ErrorHandler.logError({
                            type: 'react-parse',
                            file,
                            message: 'Failed to process JSX attribute',
                            details: String(attrError),
                            recoverable: true
                        });
                    }
                },
                
                // Handle CSS imports
                ImportDeclaration(path: any) {
                    try {
                        const source = path.node.source.value;
                        if (typeof source === 'string' && /\.(css|scss|less)$/.test(source)) {
                            // Track CSS imports for better analysis
                            console.log(`Found CSS import: ${source} in ${file}`);
                        }
                    } catch (importError) {
                        // Silently ignore import processing errors
                    }
                }
            });

            successfulFiles++;
        } catch (error) {
            failedFiles++;
            const errorMessage = error instanceof Error ? error.message : String(error);
            
            // Provide specific error messages for common issues
            let userMessage = 'Failed to parse React component';
            if (errorMessage.includes('Unexpected token')) {
                userMessage = 'Syntax error in React component';
            } else if (errorMessage.includes('Unexpected character')) {
                userMessage = 'Invalid character in React component';
            } else if (errorMessage.includes('Missing semicolon')) {
                userMessage = 'Missing semicolon in React component';
            }
            
            ErrorHandler.logError({
                type: 'react-parse',
                file,
                message: userMessage,
                details: errorMessage,
                recoverable: true
            });
        }
    }

    // Log summary if there were issues
    if (failedFiles > 0) {
        const config = getConfiguration();
        if (config.showNotifications) {
            vscode.window.showWarningMessage(
                `React Analysis: ${successfulFiles} files processed, ${failedFiles} files failed`
            );
        }
    }

    return usedClasses;
}

function isValidReactContent(content: string): boolean {
    // Check for React/JSX patterns
    const reactPatterns = [
        /import.*react/i,  // React imports
        /from\s+['"]react['"]/i,  // React imports
        /<[A-Z][a-zA-Z0-9]*/, // JSX components
        /className\s*=/, // className attributes
        /jsx?/i, // JSX pragma or file extension reference
        /export.*component/i // Component exports
    ];
    
    return reactPatterns.some(pattern => pattern.test(content));
}

function isValidClassName(className: string): boolean {
    // Validate className - should be a valid CSS class name
    return /^[a-zA-Z_-][a-zA-Z0-9_-]*$/.test(className) && className.length > 0 && className.length < 100;
}

function extractClassesFromExpression(expression: any, usedClasses: UsedClass[], file: string) {
    if (t.isStringLiteral(expression)) {
        const classes = expression.value.split(/\s+/).filter(Boolean);
        classes.forEach((className: string) => {
            usedClasses.push({ className, file });
        });
    } else if (t.isTemplateLiteral(expression)) {
        // Template literal: `btn ${isActive ? 'active' : ''}`
        expression.quasis.forEach((quasi: any) => {
            const classes = quasi.value.raw.split(/\s+/).filter(Boolean);
            classes.forEach((className: string) => {
                usedClasses.push({ className, file });
            });
        });
    } else if (t.isMemberExpression(expression)) {
        // CSS Modules: styles.button
        if (t.isIdentifier(expression.property)) {
            usedClasses.push({ className: expression.property.name, file });
        }
    } else if (t.isCallExpression(expression)) {
        // Function calls like clsx(), classnames()
        expression.arguments.forEach((arg: any) => {
            extractClassesFromExpression(arg, usedClasses, file);
        });
    } else if (t.isArrayExpression(expression)) {
        // Array of classes
        expression.elements.forEach((element: any) => {
            if (element) {
                extractClassesFromExpression(element, usedClasses, file);
            }
        });
    } else if (t.isObjectExpression(expression)) {
        // Object with conditional classes: { 'btn': true, 'active': isActive }
        expression.properties.forEach((prop: any) => {
            if (t.isObjectProperty(prop) && t.isStringLiteral(prop.key)) {
                usedClasses.push({ className: prop.key.value, file });
            }
        });
    }
}

function findUnusedSelectors(cssSelectors: CSSSelector[], usedClasses: UsedClass[]): CSSSelector[] {
    const usedClassNames = new Set(usedClasses.map(uc => uc.className));
    
    return cssSelectors.filter(selector => {
        // Extract class/id name from selector
        const match = selector.selector.match(/^[.#]([a-zA-Z0-9_-]+)/);
        if (!match) {
            return false;
        }
        
        const name = match[1];
        return !usedClassNames.has(name);
    });
}

function createDiagnosticsWithTooltips(
    unusedSelectors: CSSSelector[], 
    diagnosticCollection: vscode.DiagnosticCollection,
    cssFileCount: number,
    reactFileCount: number,
    angularFileCount: number,
    config: ExtensionConfig
) {
    const diagnosticsByFile = new Map<string, vscode.Diagnostic[]>();

    unusedSelectors.forEach(selector => {
        if (!diagnosticsByFile.has(selector.file)) {
            diagnosticsByFile.set(selector.file, []);
        }

        const line = Math.max(0, selector.line - 1); // VS Code uses 0-based line numbers
        const column = Math.max(0, selector.column - 1);
        
        const range = new vscode.Range(
            new vscode.Position(line, column),
            new vscode.Position(line, column + selector.selector.length)
        );

        // Create enhanced tooltip message
        const fileName = path.basename(selector.file);
        const tooltipMessage = createTooltipMessage(selector, fileName, cssFileCount, reactFileCount, angularFileCount);

        const diagnostic = new vscode.Diagnostic(
            range,
            tooltipMessage,
            vscode.DiagnosticSeverity.Warning
        );

        diagnostic.source = 'unused-css-detector';
        diagnostic.code = 'unused-selector';

        // Add related information for better context
        diagnostic.relatedInformation = [
            new vscode.DiagnosticRelatedInformation(
                new vscode.Location(vscode.Uri.file(selector.file), range),
                `This CSS selector "${selector.selector}" is not used in any React or Angular components`
            )
        ];

        diagnosticsByFile.get(selector.file)!.push(diagnostic);
    });

    // Apply diagnostics to each file
    diagnosticsByFile.forEach((diagnostics, file) => {
        const uri = vscode.Uri.file(file);
        diagnosticCollection.set(uri, diagnostics);
    });

    // Show notification if enabled
    if (config.showNotifications && unusedSelectors.length > 0) {
        vscode.window.showInformationMessage(
            `Found ${unusedSelectors.length} unused CSS selector${unusedSelectors.length === 1 ? '' : 's'}`
        );
    }
}

function createTooltipMessage(
    selector: CSSSelector, 
    fileName: string, 
    cssFileCount: number, 
    reactFileCount: number, 
    angularFileCount: number
): string {
    const selectorType = selector.selector.startsWith('.') ? 'class' : 'ID';
    const selectorName = selector.selector.substring(1);
    
    return `Unused CSS ${selectorType}: "${selector.selector}"

📁 File: ${fileName}
📍 Line: ${selector.line}, Column: ${selector.column}

🔍 Analysis Summary:
• Scanned ${cssFileCount} CSS file${cssFileCount === 1 ? '' : 's'}
• Checked ${reactFileCount} React component${reactFileCount === 1 ? '' : 's'}
• Checked ${angularFileCount} Angular component${angularFileCount === 1 ? '' : 's'}

💡 This ${selectorType} "${selectorName}" is not referenced in any component files.
Consider removing it to reduce bundle size.`;
}

function updateStatusBar(unusedCount: number, isAnalyzing: boolean = false) {
    if (!statusBarItem) {
        return; // Status bar is disabled
    }
    
    if (isAnalyzing) {
        statusBarItem.text = '$(sync~spin) Analyzing CSS...';
        statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        return;
    }

    if (unusedCount === 0) {
        statusBarItem.text = '$(check) No unused CSS';
        statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.prominentBackground');
        statusBarItem.tooltip = 'All CSS selectors are being used';
    } else {
        statusBarItem.text = `$(warning) ${unusedCount} unused CSS selector${unusedCount === 1 ? '' : 's'}`;
        statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        statusBarItem.tooltip = `Found ${unusedCount} unused CSS selector${unusedCount === 1 ? '' : 's'}. Click to re-analyze.`;
    }
}

async function parseAngularComponents(angularFiles: string[], workspacePath: string): Promise<UsedClass[]> {
    const usedClasses: UsedClass[] = [];
    let successfulFiles = 0;
    let failedFiles = 0;

    for (const file of angularFiles) {
        try {
            // Check file accessibility
            if (!fs.existsSync(file)) {
                ErrorHandler.logError({
                    type: 'file-access',
                    file,
                    message: 'Angular component file does not exist',
                    recoverable: true
                });
                failedFiles++;
                continue;
            }

            const stats = fs.statSync(file);
            if (stats.size > 2 * 1024 * 1024) { // 2MB limit
                ErrorHandler.logError({
                    type: 'angular-parse',
                    file,
                    message: 'Angular component file too large (>2MB), skipping for performance',
                    recoverable: true
                });
                failedFiles++;
                continue;
            }

            const content = fs.readFileSync(file, 'utf8');
            
            if (!content.trim()) {
                continue; // Skip empty files silently
            }

            // Basic validation for Angular content
            if (!isValidAngularContent(content)) {
                console.log(`[Unused CSS Detector] Skipping ${path.basename(file)} - not detected as Angular component`);
                continue; // Skip non-Angular TypeScript files silently
            }
            
            console.log(`[Unused CSS Detector] Processing Angular component: ${path.basename(file)}`);

            // Parse with Babel to find @Component decorators
            const ast = parseBabel(content, {
                sourceType: 'module',
                plugins: [
                    'typescript',
                    'decorators-legacy',
                    'classProperties'
                ],
                errorRecovery: true
            });

            const components = extractAngularComponents(ast, file, workspacePath);
            console.log(`[Unused CSS Detector] Found ${components.length} @Component decorators in ${path.basename(file)}`);
            
            if (components.length === 0) {
                console.log(`[Unused CSS Detector] No @Component decorators found in ${path.basename(file)}`);
                continue; // No Angular components found, skip silently
            }

            for (const component of components) {
                try {
                    // Parse template for class and id usage
                    if (component.template) {
                        const templateClasses = parseAngularTemplate(component.template, file);
                        usedClasses.push(...templateClasses);
                    } else if (component.templateUrl) {
                        const templatePath = resolveTemplatePath(component.templateUrl, file);
                        
                        if (!fs.existsSync(templatePath)) {
                            ErrorHandler.logError({
                                type: 'file-access',
                                file: templatePath,
                                message: `Template file not found: ${component.templateUrl}`,
                                details: `Referenced from ${path.basename(file)}`,
                                recoverable: true
                            });
                            continue;
                        }

                        try {
                            const templateContent = fs.readFileSync(templatePath, 'utf8');
                            const templateClasses = parseAngularTemplate(templateContent, templatePath);
                            usedClasses.push(...templateClasses);
                        } catch (templateError) {
                            ErrorHandler.logError({
                                type: 'angular-parse',
                                file: templatePath,
                                message: 'Failed to read Angular template file',
                                details: String(templateError),
                                recoverable: true
                            });
                        }
                    }
                } catch (componentError) {
                    ErrorHandler.logError({
                        type: 'angular-parse',
                        file,
                        message: 'Failed to process Angular component',
                        details: String(componentError),
                        recoverable: true
                    });
                }
            }

            successfulFiles++;
        } catch (error) {
            failedFiles++;
            const errorMessage = error instanceof Error ? error.message : String(error);
            
            // Provide specific error messages for common issues
            let userMessage = 'Failed to parse Angular component';
            if (errorMessage.includes('Unexpected token')) {
                userMessage = 'Syntax error in Angular component';
            } else if (errorMessage.includes('Decorator')) {
                userMessage = 'Invalid @Component decorator syntax';
            }
            
            ErrorHandler.logError({
                type: 'angular-parse',
                file,
                message: userMessage,
                details: errorMessage,
                recoverable: true
            });
        }
    }

    // Log summary if there were issues
    if (failedFiles > 0) {
        const config = getConfiguration();
        if (config.showNotifications) {
            vscode.window.showWarningMessage(
                `Angular Analysis: ${successfulFiles} files processed, ${failedFiles} files failed`
            );
        }
    }

    return usedClasses;
}

function isValidAngularContent(content: string): boolean {
    // Check for Angular patterns - made less restrictive
    const angularPatterns = [
        /@Component\s*\(/,  // @Component decorator (primary indicator)
        /from\s+['"]@angular/,  // Angular imports
        /templateUrl\s*:/,  // Template URL
        /template\s*:/,  // Inline template
        /styleUrls\s*:/,  // Style URLs
        /@Injectable\s*\(/,  // Injectable services (might have CSS)
        /@Directive\s*\(/   // Directives (might have CSS)
    ];
    
    // If it's a .ts file and has @Component, it's definitely Angular
    if (/@Component\s*\(/.test(content)) {
        return true;
    }
    
    // Otherwise, check for other Angular patterns
    return angularPatterns.some(pattern => pattern.test(content));
}

function extractAngularComponents(ast: any, file: string, workspacePath: string): AngularComponent[] {
    const components: AngularComponent[] = [];

    traverse(ast, {
        ClassDeclaration(path: any) {
            const decorators = path.node.decorators;
            if (!decorators) {
                return;
            }

            for (const decorator of decorators) {
                if (t.isDecorator(decorator) && 
                    t.isCallExpression(decorator.expression) &&
                    t.isIdentifier(decorator.expression.callee) &&
                    decorator.expression.callee.name === 'Component') {
                    
                    const args = decorator.expression.arguments;
                    if (args.length > 0 && t.isObjectExpression(args[0])) {
                        const component = parseComponentDecorator(args[0], file);
                        if (component) {
                            components.push(component);
                        }
                    }
                }
            }
        }
    });

    return components;
}

function parseComponentDecorator(objectExpression: any, file: string): AngularComponent | null {
    const component: AngularComponent = {
        file,
        styleUrls: []
    };

    for (const property of objectExpression.properties) {
        if (t.isObjectProperty(property) && t.isIdentifier(property.key)) {
            const key = property.key.name;
            
            if (key === 'template' && t.isStringLiteral(property.value)) {
                component.template = property.value.value;
            } else if (key === 'templateUrl' && t.isStringLiteral(property.value)) {
                component.templateUrl = property.value.value;
            } else if (key === 'styleUrls' && t.isArrayExpression(property.value)) {
                component.styleUrls = property.value.elements
                    .filter((element: any) => t.isStringLiteral(element))
                    .map((element: any) => element.value);
            }
        }
    }

    return component.template || component.templateUrl ? component : null;
}

function parseAngularTemplate(template: string, file: string): UsedClass[] {
    const usedClasses: UsedClass[] = [];
    
    // Regular expressions to find class and id attributes in Angular templates
    const classRegex = /\bclass\s*=\s*["']([^"']+)["']/gi;
    const ngClassRegex = /\[ngClass\]\s*=\s*["']([^"']+)["']/gi;
    const idRegex = /\bid\s*=\s*["']([^"']+)["']/gi;
    
    // Extract static class attributes
    let match;
    while ((match = classRegex.exec(template)) !== null) {
        const classes = match[1].split(/\s+/).filter(Boolean);
        classes.forEach(className => {
            usedClasses.push({ className, file });
        });
    }
    
    // Extract ngClass attributes (simplified - handles string literals)
    while ((match = ngClassRegex.exec(template)) !== null) {
        const classes = match[1].split(/\s+/).filter(Boolean);
        classes.forEach(className => {
            usedClasses.push({ className, file });
        });
    }
    
    // Extract id attributes
    while ((match = idRegex.exec(template)) !== null) {
        usedClasses.push({ className: match[1], file });
    }
    
    // Handle interpolated classes: {{ someClass }}
    const interpolationRegex = /\{\{\s*([^}]+)\s*\}\}/g;
    while ((match = interpolationRegex.exec(template)) !== null) {
        const expression = match[1].trim();
        // Simple heuristic: if it looks like a class name (no spaces, dots, or operators)
        if (/^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(expression)) {
            usedClasses.push({ className: expression, file });
        }
    }
    
    // Handle [class.className]="condition" syntax
    const classBindingRegex = /\[class\.([a-zA-Z0-9_-]+)\]/g;
    while ((match = classBindingRegex.exec(template)) !== null) {
        usedClasses.push({ className: match[1], file });
    }

    return usedClasses;
}

function resolveTemplatePath(templateUrl: string, componentFile: string): string {
    const componentDir = path.dirname(componentFile);
    return path.resolve(componentDir, templateUrl);
}

function showErrorSummary() {
    const summary = ErrorHandler.getErrorSummary();
    
    if (summary.total === 0) {
        vscode.window.showInformationMessage('No errors recorded in current session');
        return;
    }

    const errorDetails = Object.entries(summary.byType)
        .map(([type, count]) => `${type}: ${count}`)
        .join('\n');

    const content = `
# Unused CSS Detector - Error Summary

**Total Errors**: ${summary.total}

## Errors by Type:
${errorDetails}

## Error Types Explained:
- **css-parse**: Issues parsing CSS/SCSS/LESS files
- **react-parse**: Issues parsing React/JSX components  
- **angular-parse**: Issues parsing Angular components
- **file-access**: File system access problems
- **configuration**: Extension configuration issues
- **general**: Other unexpected errors

## Troubleshooting:
1. Check file permissions and accessibility
2. Verify syntax in problematic files
3. Review extension configuration settings
4. Try excluding problematic files using excludePatterns
5. Restart VS Code if issues persist

Generated: ${new Date().toLocaleString()}
    `.trim();

    vscode.workspace.openTextDocument({
        content,
        language: 'markdown'
    }).then(doc => {
        vscode.window.showTextDocument(doc);
    });
}

export function deactivate() {
    if (statusBarItem) {
        statusBarItem.dispose();
    }
    if (debounceTimer) {
        clearTimeout(debounceTimer);
    }
}