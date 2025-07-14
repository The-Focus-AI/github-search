#!/usr/bin/env node

import { execSync, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

interface RepoInfo {
  name: string;
  owner: string;
  url: string;
  description: string;
  stars: number;
  language: string;
}

interface AnalysisResult {
  repo: RepoInfo;
  localPath: string;
  files: string[];
  matchingFiles: string[];
  analysis: any;
}

class GitHubRepoAnalyzer {
  private tempDir: string;
  private results: AnalysisResult[] = [];

  constructor() {
    this.tempDir = path.join(os.tmpdir(), 'github-analysis-' + Date.now());
    fs.mkdirSync(this.tempDir, { recursive: true });
  }

  async searchRepositories(query: string, limit: number = 10): Promise<RepoInfo[]> {
    try {
      console.log(`🔍 Searching for repositories with query: "${query}"`);
      
      const command = `gh search repos "${query}" --limit ${limit} --json name,owner,url,description,stargazersCount,language`;
      const output = execSync(command, { encoding: 'utf8' });
      
      const repos = JSON.parse(output);
      
      return repos.map((repo: any) => ({
        name: repo.name,
        owner: repo.owner.login || repo.owner, // owner may be an object or string
        url: repo.url,
        description: repo.description || '',
        stars: repo.stargazersCount || 0,
        language: repo.language || 'Unknown'
      }));
    } catch (error) {
      console.error('Error searching repositories:', error);
      throw error;
    }
  }

  async cloneRepository(repo: RepoInfo): Promise<string> {
    const repoPath = path.join(this.tempDir, `${repo.owner}-${repo.name}`);
    
    try {
      console.log(`📦 Cloning ${repo.owner}/${repo.name}...`);
      
      // Use shallow clone for faster downloads
      execSync(`git clone --depth 1 ${repo.url} "${repoPath}"`, { 
        stdio: 'pipe',
        timeout: 30000 // 30 second timeout
      });
      
      return repoPath;
    } catch (error) {
      console.error(`Failed to clone ${repo.owner}/${repo.name}:`, error);
      throw error;
    }
  }

  private getAllFiles(dir: string, fileList: string[] = []): string[] {
    const files = fs.readdirSync(dir);
    
    files.forEach(file => {
      const filePath = path.join(dir, file);
      const stat = fs.statSync(filePath);
      
      if (stat.isDirectory()) {
        // Skip .git and node_modules directories
        if (!file.startsWith('.git') && file !== 'node_modules') {
          this.getAllFiles(filePath, fileList);
        }
      } else {
        fileList.push(filePath);
      }
    });
    
    return fileList;
  }

  private findMatchingFiles(files: string[], patterns: string[]): string[] {
    return files.filter(file => {
      const basename = path.basename(file);
      const relativePath = file.split(path.sep).slice(-3).join('/'); // Last 3 parts of path
      
      return patterns.some(pattern => {
        // Support glob-like patterns
        if (pattern.includes('*')) {
          const regex = new RegExp(pattern.replace(/\*/g, '.*'), 'i');
          return regex.test(basename) || regex.test(relativePath);
        }
        
        // Exact match or contains
        return basename.toLowerCase().includes(pattern.toLowerCase()) ||
               relativePath.toLowerCase().includes(pattern.toLowerCase());
      });
    });
  }

  private analyzeRepository(repoPath: string, repo: RepoInfo, filePatterns: string[]): any {
    const analysis: any = {
      totalFiles: 0,
      fileTypes: {},
      structure: {},
      readme: null,
      packageJson: null,
      specialFiles: []
    };

    try {
      const allFiles = this.getAllFiles(repoPath);
      analysis.totalFiles = allFiles.length;

      // Analyze file types
      allFiles.forEach(file => {
        const ext = path.extname(file).toLowerCase();
        const key = ext || 'no-extension';
        analysis.fileTypes[key] = (analysis.fileTypes[key] || 0) + 1;
      });

      // Look for README
      const readmeFiles = allFiles.filter(file => 
        /readme/i.test(path.basename(file))
      );
      if (readmeFiles.length > 0) {
        analysis.readme = readmeFiles[0];
      }

      // Look for package.json
      const packageJsonFiles = allFiles.filter(file => 
        path.basename(file) === 'package.json'
      );
      if (packageJsonFiles.length > 0) {
        analysis.packageJson = packageJsonFiles[0];
        try {
          const packageContent = fs.readFileSync(packageJsonFiles[0], 'utf8');
          analysis.packageData = JSON.parse(packageContent);
        } catch (e) {
          // Ignore parse errors
        }
      }

      // Find special files based on patterns
      const matchingFiles = this.findMatchingFiles(allFiles, filePatterns);
      analysis.specialFiles = matchingFiles.map(file => ({
        path: file.replace(repoPath, '').replace(/^\//, ''),
        size: fs.statSync(file).size
      }));

      // Basic directory structure (top level)
      const topLevelItems = fs.readdirSync(repoPath);
      topLevelItems.forEach(item => {
        const itemPath = path.join(repoPath, item);
        const stat = fs.statSync(itemPath);
        analysis.structure[item] = stat.isDirectory() ? 'directory' : 'file';
      });

    } catch (error) {
      console.error(`Error analyzing ${repo.name}:`, error);
      analysis.error = error.message;
    }

    return analysis;
  }

  async analyzeRepositories(
    query: string, 
    filePatterns: string[] = [],
    limit: number = 10
  ): Promise<AnalysisResult[]> {
    try {
      // Search for repositories
      const repos = await this.searchRepositories(query, limit);
      console.log(`Found ${repos.length} repositories`);

      // Clone and analyze each repository
      for (const repo of repos) {
        try {
          const localPath = await this.cloneRepository(repo);
          const allFiles = this.getAllFiles(localPath);
          const matchingFiles = this.findMatchingFiles(allFiles, filePatterns);
          const analysis = this.analyzeRepository(localPath, repo, filePatterns);

          this.results.push({
            repo,
            localPath,
            files: allFiles.map(f => f.replace(localPath, '').replace(/^\//, '')),
            matchingFiles: matchingFiles.map(f => f.replace(localPath, '').replace(/^\//, '')),
            analysis
          });

          console.log(`✅ Analyzed ${repo.owner}/${repo.name} (${matchingFiles.length} matching files)`);
        } catch (error) {
          console.error(`❌ Failed to analyze ${repo.owner}/${repo.name}:`, error);
        }
      }

      return this.results;
    } catch (error) {
      console.error('Error in analysis process:', error);
      throw error;
    }
  }

  generateReport(): string {
    let report = `# GitHub Repository Analysis Report\n\n`;
    report += `Generated on: ${new Date().toISOString()}\n`;
    report += `Total repositories analyzed: ${this.results.length}\n\n`;

    this.results.forEach((result, index) => {
      const { repo, matchingFiles, analysis } = result;
      
      report += `## ${index + 1}. ${repo.owner}/${repo.name}\n\n`;
      report += `**Description:** ${repo.description}\n`;
      report += `**Stars:** ${repo.stars} | **Language:** ${repo.language}\n`;
      report += `**URL:** ${repo.url}\n\n`;
      
      if (analysis.error) {
        report += `**Error:** ${analysis.error}\n\n`;
        return;
      }

      report += `**Files:** ${analysis.totalFiles} total\n`;
      report += `**Matching files:** ${matchingFiles.length}\n\n`;

      if (matchingFiles.length > 0) {
        report += `**Matching files found:**\n`;
        matchingFiles.slice(0, 10).forEach(file => {
          report += `- ${file}\n`;
        });
        if (matchingFiles.length > 10) {
          report += `- ... and ${matchingFiles.length - 10} more\n`;
        }
        report += `\n`;
      }

      // Top file types
      const topTypes = Object.entries(analysis.fileTypes)
        .sort(([,a], [,b]) => (b as number) - (a as number))
        .slice(0, 5);
      
      if (topTypes.length > 0) {
        report += `**Top file types:**\n`;
        topTypes.forEach(([ext, count]) => {
          report += `- ${ext}: ${count} files\n`;
        });
        report += `\n`;
      }

      report += `---\n\n`;
    });

    return report;
  }

  async readFileContent(repoIndex: number, filePath: string): Promise<string> {
    if (repoIndex >= this.results.length) {
      throw new Error('Invalid repository index');
    }

    const fullPath = path.join(this.results[repoIndex].localPath, filePath);
    
    if (!fs.existsSync(fullPath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    return fs.readFileSync(fullPath, 'utf8');
  }

  cleanup(): void {
    try {
      if (fs.existsSync(this.tempDir)) {
        fs.rmSync(this.tempDir, { recursive: true, force: true });
        console.log('🧹 Cleaned up temporary files');
      }
    } catch (error) {
      console.error('Error cleaning up:', error);
    }
  }
}

// CLI interface
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log(`
Usage: node github-analyzer.js <search-query> [file-patterns...] [options]

Examples:
  node github-analyzer.js "dotfiles" "*.zsh" "*.bash" --limit 15
  node github-analyzer.js "claude.md" --limit 10
  node github-analyzer.js "cursor rules" ".cursor/rules" "cursor-rules" --limit 20

Options:
  --limit <number>    Number of repositories to analyze (default: 10)
  --help             Show this help message
`);
    return;
  }

  if (args.includes('--help')) {
    console.log(`\nUsage: node github-analyzer.js <search-query> [file-patterns...] [options]\n\nExamples:\n  node github-analyzer.js "dotfiles" "*.zsh" "*.bash" --limit 15\n  node github-analyzer.js "claude.md" --limit 10\n  node github-analyzer.js "cursor rules" ".cursor/rules" "cursor-rules" --limit 20\n\nOptions:\n  --limit <number>    Number of repositories to analyze (default: 10)\n  --help             Show this help message\n`);
    return;
  }

  const limitIndex = args.findIndex(arg => arg === '--limit');
  const limit = limitIndex !== -1 && args[limitIndex + 1] 
    ? parseInt(args[limitIndex + 1]) 
    : 10;

  const query = args[0];
  const filePatterns = args.slice(1).filter(arg => arg !== '--limit' && !arg.match(/^\d+$/));

  const analyzer = new GitHubRepoAnalyzer();

  try {
    console.log(`🚀 Starting analysis...`);
    console.log(`Query: "${query}"`);
    console.log(`File patterns: ${filePatterns.length > 0 ? filePatterns.join(', ') : 'None'}`);
    console.log(`Limit: ${limit}`);
    console.log('');

    const results = await analyzer.analyzeRepositories(query, filePatterns, limit);
    
    console.log('\n📊 Analysis complete!');
    console.log('\n' + analyzer.generateReport());

    // Save report to file
    const reportPath = `analysis-report-${Date.now()}.md`;
    fs.writeFileSync(reportPath, analyzer.generateReport());
    console.log(`📄 Report saved to: ${reportPath}`);

  } catch (error) {
    console.error('❌ Analysis failed:', error);
  } finally {
    // analyzer.cleanup();
    console.log(`\n🗂️  Repositories are checked out to: ${analyzer["tempDir"]}`);
  }
}

// Export for programmatic use
export { GitHubRepoAnalyzer, RepoInfo, AnalysisResult };

// Run CLI if this is the main module
if (require.main === module) {
  main().catch(console.error);
}