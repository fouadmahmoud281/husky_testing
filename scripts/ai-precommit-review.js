const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// OpenAI configuration
const OpenAI = require('openai');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini'; // Use faster model for pre-commit
const MAX_TOKENS = parseInt(process.env.MAX_TOKENS_PRECOMMIT) || 500; // Shorter response

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

function colorize(text, color) {
  return `${colors[color]}${text}${colors.reset}`;
}

function getStagedDiff() {
  try {
    // Get diff of staged files only (what's about to be committed)
    const diff = execSync('git diff --cached', { encoding: 'utf8' });
    return diff;
  } catch (error) {
    console.error(colorize('Error getting staged diff:', 'red'), error.message);
    return null;
  }
}

function getStagedFiles() {
  try {
    const files = execSync('git diff --cached --name-only', { encoding: 'utf8' });
    return files.trim().split('\n').filter(file => file.length > 0);
  } catch (error) {
    console.error(colorize('Error getting staged files:', 'red'), error.message);
    return [];
  }
}

async function quickReviewCode(diff, stagedFiles) {
  if (!diff || diff.trim().length === 0) {
    console.log(colorize('No staged changes detected. Skipping pre-commit review.', 'yellow'));
    return { success: true, recommendations: [] };
  }

  // Pre-commit focuses on CRITICAL issues that must be caught before commit
  const prompt = `
You are a CRITICAL ISSUE DETECTOR for pre-commit checks. Analyze the staged changes and provide IMMEDIATE feedback on build-breaking or critical issues.

🚨 CRITICAL CHECKS (MUST REVIEW):
1. **Syntax & Build Issues**: Missing semicolons, brackets, syntax errors, import/export problems
2. **Security Vulnerabilities**: Hardcoded secrets, API keys, passwords, SQL injection, XSS patterns
3. **Code Style Violations**: Linting errors, formatting issues, naming conventions
4. **Type Errors**: TypeScript errors, undefined variables, wrong types

Staged files: ${stagedFiles.join(', ')}

Git diff (staged changes):
\`\`\`diff
${diff}
\`\`\`

Respond in this format:
**STATUS:** [PASS/FAIL]

**🚨 CRITICAL ISSUES** (if any):
- [SYNTAX] Issue description
- [SECURITY] Issue description  
- [STYLE] Issue description
- [TYPE] Issue description

**✅ PASSED CHECKS**:
- Syntax validation
- Security scan
- Style compliance
- Type checking

Only flag issues that would break the build or pose immediate security risks. Keep responses under 300 words.
`;

  try {
    console.log(colorize('⚡ Quick AI pre-commit review...', 'cyan'));
    
    const response = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        {
          role: 'system',
          content: 'You are a fast pre-commit code reviewer. Focus only on critical, build-breaking issues. Be concise.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      max_tokens: MAX_TOKENS,
      temperature: 0.1, // More focused responses
    });

    const review = response.choices[0].message.content;
    console.log(colorize('\n⚡ Pre-commit Review:', 'bright'));
    console.log('-'.repeat(40));
    console.log(review);
    console.log('-'.repeat(40));

    // Parse status
    const statusMatch = review.match(/\*\*STATUS:\*\*\s*(PASS|FAIL)/i);
    const status = statusMatch ? statusMatch[1].toUpperCase() : 'PASS';

    const shouldBlock = status === 'FAIL';
    
    if (shouldBlock) {
      console.log(colorize('\n🚫 Pre-commit blocked - Critical issues found!', 'red'));
      console.log(colorize('Fix these issues before committing.', 'red'));
    } else {
      console.log(colorize('\n✅ Pre-commit check passed!', 'green'));
    }

    return {
      success: !shouldBlock,
      status,
      review,
      type: 'pre-commit'
    };

  } catch (error) {
    console.error(colorize('Error during pre-commit AI review:', 'red'), error.message);
    
    if (error.message.includes('API key')) {
      console.error(colorize('\n🔑 Please set your OpenAI API key in the .env file:', 'yellow'));
      console.error(colorize('OPENAI_API_KEY=your_api_key_here', 'cyan'));
    }
    
    // Don't block commit on API errors for pre-commit
    console.log(colorize('\n⚠️  Pre-commit AI review failed, but allowing commit.', 'yellow'));
    return { success: true, error: error.message };
  }
}

function saveQuickReviewLog(review, stagedFiles) {
  const logDir = path.join(process.cwd(), '.husky', 'logs');
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logFile = path.join(logDir, `pre-commit-${timestamp}.md`);
  
  const logContent = `# Pre-commit AI Review Log
**Date:** ${new Date().toLocaleString()}
**Type:** Pre-commit Quick Review
**Staged Files:** ${stagedFiles.join(', ')}

${review.review || review.error || 'Review completed'}
`;

  fs.writeFileSync(logFile, logContent);
  console.log(colorize(`📝 Pre-commit log: ${path.basename(logFile)}`, 'blue'));
}

async function main() {
  console.log(colorize('⚡ Pre-commit AI Review (Quick Check)...', 'bright'));
  
  // Check if OpenAI API key is configured
  if (!process.env.OPENAI_API_KEY) {
    console.error(colorize('❌ OPENAI_API_KEY not found.', 'red'));
    console.error(colorize('Please copy .env.example to .env and add your API key.', 'yellow'));
    console.log(colorize('⚠️  Skipping AI review, allowing commit.', 'yellow'));
    process.exit(0); // Don't block commit if no API key
  }

  const diff = getStagedDiff();
  const stagedFiles = getStagedFiles();

  if (!diff || diff.trim().length === 0) {
    console.log(colorize('No staged changes. Skipping review.', 'yellow'));
    process.exit(0);
  }

  console.log(colorize(`📁 Staged files: ${stagedFiles.join(', ')}`, 'blue'));
  
  const result = await quickReviewCode(diff, stagedFiles);
  
  // Save review log
  saveQuickReviewLog(result, stagedFiles);
  
  if (!result.success) {
    process.exit(1);
  }
  
  console.log(colorize('🎉 Pre-commit review completed!', 'green'));
}

// Run the main function
main().catch((error) => {
  console.error(colorize('Unexpected error:', 'red'), error);
  console.log(colorize('⚠️  Error occurred, but allowing commit.', 'yellow'));
  process.exit(0); // Don't block commit on unexpected errors
});
