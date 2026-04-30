const vscode = require('vscode');
const WIN_TASKS = require('./winTasks');
const { loadCustomSnippets } = require('./customSnippets');

class CategoryItem extends vscode.TreeItem {
  constructor(label, contextValue) {
    super(label, vscode.TreeItemCollapsibleState.Expanded);
    this.contextValue = contextValue;
  }
}

class SnippetItem extends vscode.TreeItem {
  constructor(snippet, source) {
    super(snippet.name, vscode.TreeItemCollapsibleState.None);
    this.description = snippet.desc || '';
    this.tooltip = snippet.desc || snippet.name;
    this.contextValue = 'snippet';
    this.iconPath = new vscode.ThemeIcon(source === 'builtin' ? 'symbol-snippet' : 'file-code');
    this.command = {
      command: 'ansible.insertSnippet',
      title: 'Insert Snippet',
      arguments: [snippet.snippet],
    };
  }
}

class SnippetTreeProvider {
  constructor() {
    this._onDidChangeTreeData = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChangeTreeData.event;
    this._customSnippets = [];
  }

  async refresh() {
    const cfg = vscode.workspace.getConfiguration('ansible');
    this._customSnippets = await loadCustomSnippets(
      cfg.get('customSnippetsPath'),
      cfg.get('wslDistro')
    );
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element) {
    return element;
  }

  getChildren(element) {
    if (!element) {
      return [
        new CategoryItem('Built-in (Windows)', 'builtin-category'),
        new CategoryItem('Custom', 'custom-category'),
      ];
    }
    if (element.contextValue === 'builtin-category') {
      return WIN_TASKS.map(t => new SnippetItem(t, 'builtin'));
    }
    if (element.contextValue === 'custom-category') {
      if (this._customSnippets.length === 0) {
        const empty = new vscode.TreeItem('No custom snippets — set ansible.customSnippetsPath');
        empty.contextValue = 'empty';
        return [empty];
      }
      return this._customSnippets.map(t => new SnippetItem(t, 'custom'));
    }
    return [];
  }
}

module.exports = SnippetTreeProvider;
