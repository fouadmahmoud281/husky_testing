const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { reviewTypes, reviewPrompts } = require('./review-config');

// OpenAI configuration
const OpenAI = require('openai');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

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

function getDiff(reviewType = 'prepush') {
  try {
    if (reviewType === 'precommit') {
      // Get staged files only for pre-commit - this should always reflect current staged changes
      const diff = execSync('git diff --cached', { encoding: 'utf8' });
      
      // If no staged changes, check if there are any changes at all
      if (!diff || diff.trim().length === 0) {
        console.log(colorize('No staged changes found. Make sure you have staged your files with git add.', 'yellow'));
        return null;
      }
      
      return diff;
    } else {
      // For pre-push and other reviews, get all changes since last commit
      let baseBranch = 'origin/main';
      
      // Try to find the right base branch
      try {
        execSync('git rev-parse --verify origin/main', { stdio: 'pipe' });
      } catch {
        try {
          execSync('git rev-parse --verify origin/master', { stdio: 'pipe' });
          baseBranch = 'origin/master';
        } catch {
          try {
            execSync('git rev-parse --verify main', { stdio: 'pipe' });
            baseBranch = 'main';
          } catch {
            try {
              execSync('git rev-parse --verify master', { stdio: 'pipe' });
              baseBranch = 'master';
            } catch {
              // Fall back to comparing with the previous commit
              baseBranch = 'HEAD~1';
            }
          }
        }
      }
      
      const diff = execSync(`git diff ${baseBranch}...HEAD`, { encoding: 'utf8' });
      
      // If no diff with base branch, try with unstaged changes
      if (!diff || diff.trim().length === 0) {
        const unstagedDiff = execSync('git diff HEAD', { encoding: 'utf8' });
        if (unstagedDiff && unstagedDiff.trim().length > 0) {
          console.log(colorize('Found unstaged changes, including them in review.', 'yellow'));
          return unstagedDiff;
        }
      }
      
      return diff;
    }
  } catch (error) {
    console.error(colorize('Error getting git diff:', 'red'), error.message);
    return null;
  }
}

function getChangedFiles(reviewType = 'prepush') {
  try {
    if (reviewType === 'precommit') {
      const files = execSync('git diff --cached --name-only', { encoding: 'utf8' });
      const stagedFiles = files.trim().split('\n').filter(file => file.length > 0);
      
      // If no staged files, provide helpful message
      if (stagedFiles.length === 0 || (stagedFiles.length === 1 && stagedFiles[0] === '')) {
        console.log(colorize('No staged files found. Use "git add <file>" to stage your changes.', 'yellow'));
        return [];
      }
      
      return stagedFiles;
    } else {
      // For pre-push, get all changed files
      let files;
      try {
        files = execSync('git diff --name-only HEAD~1...HEAD', { encoding: 'utf8' });
      } catch {
        // If no previous commits, get all tracked files that are different from staging
        files = execSync('git diff --name-only HEAD', { encoding: 'utf8' });
      }
      
      const changedFiles = files.trim().split('\n').filter(file => file.length > 0);
      
      // If no changed files in commits, check for unstaged changes
      if (changedFiles.length === 0 || (changedFiles.length === 1 && changedFiles[0] === '')) {
        const unstagedFiles = execSync('git diff --name-only', { encoding: 'utf8' });
        const unstagedList = unstagedFiles.trim().split('\n').filter(file => file.length > 0);
        
        if (unstagedList.length > 0 && !(unstagedList.length === 1 && unstagedList[0] === '')) {
          console.log(colorize('Including unstaged files in review.', 'yellow'));
          return unstagedList;
        }
      }
      
      return changedFiles;
    }
  } catch (error) {
    console.error(colorize('Error getting changed files:', 'red'), error.message);
    return [];
  }
}

function extractScore(review, category) {
  const regex = new RegExp(`\\*\\*${category}:\\*\\*\\s*\\[Score:\\s*(\\d+)/10\\]`, 'i');
  const match = review.match(regex);
  return match ? parseInt(match[1]) : 7;
}

async function performReview(reviewType, diff, changedFiles) {
  if (!diff || diff.trim().length === 0) {
    console.log(colorize(`No changes detected for ${reviewType} review.`, 'yellow'));
    return { success: true, noChanges: true };
  }

  const config = reviewTypes[reviewType];
  if (!config) {
    throw new Error(`Unknown review type: ${reviewType}`);
  }

  // Generate a unique review ID for this run
  const reviewId = `${reviewType}-${Date.now().toString(36)}`;
  console.log(colorize(`🔍 Review ID: ${reviewId}`, 'blue'));

  // Filter diff to remove deleted lines for AI analysis (prevents false positives)
  const filteredDiff = reviewType === 'precommit' ? filterDiffForAddedLines(diff) : diff;
  
  const basePrompt = reviewPrompts[reviewType];
  const fullPrompt = `${basePrompt}

REVIEW SESSION: ${reviewId}
Changed files: ${changedFiles.join(', ')}

Git diff (showing only additions and context):
\`\`\`diff
${filteredDiff}
\`\`\`

Analyze the above changes according to the specified focus areas. This is a fresh review of the current staged/changed code.`;

  try {
    console.log(colorize(`🤖 Running ${config.name}...`, 'cyan'));
    
    const startTime = Date.now();
    const response = await Promise.race([
      openai.chat.completions.create({
        model: config.model,
        messages: [        {
          role: 'system',
          content: `You are an expert code reviewer specializing in ${config.focus.join(', ')}. Provide actionable, specific feedback. Each review is independent - analyze only the current code changes provided.

🚨 CRITICAL GIT DIFF INSTRUCTIONS:
You are analyzing a GIT DIFF. The format is:
- Lines starting with "+" are NEWLY ADDED code → ANALYZE THESE FOR ISSUES
- Lines starting with "-" are REMOVED/DELETED code → DO NOT FLAG THESE AS ISSUES (they're being fixed)
- Lines starting with " " are unchanged context lines → IGNORE THESE

⚠️ ONLY REVIEW ADDED CODE: Flag issues ONLY in lines that start with "+". 
✅ IGNORE REMOVED CODE: Do NOT flag any issues in lines that start with "-" (these are being deleted/fixed).
❌ PRAISE DELETIONS: If problematic code is being removed (- lines), this is POSITIVE, not an issue.

🔍 EXAMPLE ANALYSIS:
If you see: "- api_key = ''" → This is GOOD (bad code being removed) - DO NOT FLAG
If you see: "+ api_key = ''" → This is BAD (new problematic code) - FLAG THIS

Remember: Lines with "-" prefix are DISAPPEARING from the codebase (good cleanup), not being added.`
        },
          {
            role: 'user',
            content: fullPrompt
          }
        ],
        max_tokens: config.maxTokens,
        temperature: config.temperature,
      }),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Review timeout')), config.timeoutMs)
      )
    ]);

    const reviewTime = Date.now() - startTime;
    const review = response.choices[0].message.content;

    // Display results
    console.log(colorize(`\n📋 ${config.name} Results (${reviewTime}ms) - ID: ${reviewId}:`, 'bright'));
    console.log('='.repeat(80));
    console.log(review);
    console.log('='.repeat(80));

    // Parse results based on review type
    let result = { success: true, review, reviewType, reviewTime, reviewId };

    if (reviewType === 'precommit') {
      const statusMatch = review.match(/\*\*STATUS:\*\*\s*(PASS|FAIL)/i);
      const status = statusMatch ? statusMatch[1].toUpperCase() : 'PASS';
      result.status = status;
      result.success = status === 'PASS';

      if (!result.success) {
        console.log(colorize('\n🚫 Pre-commit blocked!', 'red'));
      } else {
        console.log(colorize('\n✅ Pre-commit check passed!', 'green'));
      }
    } else if (reviewType === 'prepush') {
      const assessmentMatch = review.match(/\*\*OVERALL ASSESSMENT:\*\*\s*(EXCELLENT|GOOD|NEEDS_IMPROVEMENT|CRITICAL_ISSUES)/i);
      const assessment = assessmentMatch ? assessmentMatch[1].toUpperCase() : 'NEEDS_IMPROVEMENT';
      
      const scores = {
        quality: extractScore(review, 'CODE QUALITY'),
        performance: extractScore(review, 'PERFORMANCE'),
        security: extractScore(review, 'SECURITY'),
        testing: extractScore(review, 'TESTING'),
        documentation: extractScore(review, 'DOCUMENTATION'),
        react: extractScore(review, 'REACT/FRONTEND')
      };

      const overallScore = Object.values(scores).reduce((a, b) => a + b, 0) / Object.keys(scores).length;
      
      const shouldBlock = assessment === 'CRITICAL_ISSUES' || 
                         scores.security < config.scoreThresholds.security || 
                         scores.quality < config.scoreThresholds.quality ||
                         overallScore < config.scoreThresholds.overall;

      result.assessment = assessment;
      result.scores = scores;
      result.overallScore = overallScore;
      result.success = !shouldBlock;

      if (shouldBlock) {
        console.log(colorize('\n🚫 Push blocked!', 'red'));
        console.log(colorize(`Overall Score: ${overallScore.toFixed(1)}/10`, 'red'));
      } else if (overallScore < 7) {
        console.log(colorize('\n📝 Push allowed with recommendations', 'yellow'));
        console.log(colorize(`Overall Score: ${overallScore.toFixed(1)}/10`, 'yellow'));
      } else {
        console.log(colorize('\n✅ Excellent work!', 'green'));
        console.log(colorize(`Overall Score: ${overallScore.toFixed(1)}/10`, 'green'));
      }
    } else {
      // For specialized reviews, extract score if available
      const scoreMatch = review.match(/\*\*.*SCORE:\*\*\s*\[(\d+)\/10\]/i);
      if (scoreMatch) {
        result.score = parseInt(scoreMatch[1]);
        console.log(colorize(`\n📊 ${config.name} Score: ${result.score}/10`, 
          result.score >= 8 ? 'green' : result.score >= 6 ? 'yellow' : 'red'));
      }
    }

    return result;

  } catch (error) {
    console.error(colorize(`Error during ${config.name}:`, 'red'), error.message);
    
    if (error.message.includes('API key')) {
      console.error(colorize('\n🔑 Please set your OpenAI API key in .env file', 'yellow'));
    } else if (error.message === 'Review timeout') {
      console.error(colorize(`\n⏱️  Review timed out after ${config.timeoutMs}ms`, 'yellow'));
    }
    
    // Only block for critical review types
    const shouldBlock = config.blocking.length > 0 && reviewType === 'precommit';
    if (!shouldBlock) {
      console.log(colorize(`\n⚠️  ${config.name} failed, but continuing...`, 'yellow'));
    }
    
    return { success: !shouldBlock, error: error.message, reviewType };
  }
}

function saveReviewLog(result, changedFiles) {
  const logDir = path.join(process.cwd(), '.husky', 'logs');
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logFile = path.join(logDir, `${result.reviewType}-${timestamp}.md`);
  
  let logContent = `# ${reviewTypes[result.reviewType].name} Log
**Date:** ${new Date().toLocaleString()}
**Review Type:** ${result.reviewType}
**Files:** ${changedFiles.join(', ')}
**Duration:** ${result.reviewTime || 'N/A'}ms
`;

  if (result.scores) {
    logContent += `\n**Scores:**\n`;
    Object.entries(result.scores).forEach(([key, score]) => {
      logContent += `- ${key}: ${score}/10\n`;
    });
    logContent += `**Overall Score:** ${result.overallScore?.toFixed(1) || 'N/A'}/10\n`;
  }

  logContent += `\n**Status:** ${result.success ? 'PASSED' : 'FAILED'}\n\n`;
  logContent += result.review || result.error || 'Review completed';

  fs.writeFileSync(logFile, logContent);
  console.log(colorize(`📝 Log saved: ${path.basename(logFile)}`, 'blue'));
}

function filterDiffForAddedLines(diff) {
  if (!diff) return diff;
  
  const lines = diff.split('\n');
  const filteredLines = [];
  let inFileHeader = false;
  
  for (const line of lines) {
    // Keep file headers and context
    if (line.startsWith('diff --git') || line.startsWith('index ') || line.startsWith('+++') || line.startsWith('---') || line.startsWith('@@')) {
      filteredLines.push(line);
      inFileHeader = true;
    }
    // Keep added lines (+ prefix)
    else if (line.startsWith('+')) {
      filteredLines.push(line);
      inFileHeader = false;
    }
    // Keep context lines (space prefix) but limit them
    else if (line.startsWith(' ') && !inFileHeader) {
      filteredLines.push(line);
    }
    // Skip removed lines (- prefix) - this is the key fix
    else if (line.startsWith('-') && !line.startsWith('---')) {
      // Skip deleted lines completely - don't send to AI
      continue;
    }
    else {
      filteredLines.push(line);
    }
  }
  
  return filteredLines.join('\n');
}

async function main() {
  const reviewType = process.argv[2] || 'prepush';
  
  if (!reviewTypes[reviewType]) {
    console.error(colorize(`❌ Unknown review type: ${reviewType}`, 'red'));
    console.log(colorize('Available types:', 'yellow'), Object.keys(reviewTypes).join(', '));
    process.exit(1);
  }

  console.log(colorize(`🚀 Starting ${reviewTypes[reviewType].name}...`, 'bright'));
  
  if (!process.env.OPENAI_API_KEY) {
    console.error(colorize('❌ OPENAI_API_KEY not found', 'red'));
    console.error(colorize('Please copy .env.example to .env and add your API key', 'yellow'));
    process.exit(reviewType === 'precommit' ? 0 : 1);
  }

  const diff = getDiff(reviewType);
  const changedFiles = getChangedFiles(reviewType);

  // Better handling of no changes scenario
  if (!diff || diff.trim().length === 0) {
    if (reviewType === 'precommit') {
      console.log(colorize('❌ No staged changes found!', 'red'));
      console.log(colorize('To stage your changes, run:', 'yellow'));
      console.log(colorize('  git add <filename>', 'cyan'));
      console.log(colorize('  git add .  (to add all changes)', 'cyan'));
      console.log(colorize('Then try committing again.', 'yellow'));
      process.exit(1); // Block commit if no staged changes
    } else {
      console.log(colorize('No changes detected for review. Skipping.', 'yellow'));
      process.exit(0);
    }
  }

  if (changedFiles.length === 0) {
    if (reviewType === 'precommit') {
      console.log(colorize('❌ No staged files found!', 'red'));
      console.log(colorize('Make sure to stage your changes with git add before committing.', 'yellow'));
      process.exit(1);
    } else {
      console.log(colorize('No changed files detected.', 'yellow'));
      process.exit(0);
    }
  }

  console.log(colorize(`📁 ${reviewType === 'precommit' ? 'Staged' : 'Changed'} files: ${changedFiles.join(', ')}`, 'blue'));
  
  // Filter diff to include only added lines
  const filteredDiff = filterDiffForAddedLines(diff);
  
  const result = await performReview(reviewType, filteredDiff, changedFiles);
  
  if (!result.noChanges) {
    saveReviewLog(result, changedFiles);
  }
  
  if (!result.success) {
    if (reviewType === 'precommit') {
      console.log(colorize('\n💡 To fix issues and retry:', 'yellow'));
      console.log(colorize('1. Fix the issues mentioned above', 'cyan'));
      console.log(colorize('2. Stage your changes: git add <filename>', 'cyan'));
      console.log(colorize('3. Try committing again: git commit -m "your message"', 'cyan'));
    }
    process.exit(1);
  }
  
  console.log(colorize(`\n🎉 ${reviewTypes[reviewType].name} completed!`, 'green'));
}

// Handle different ways this script might be called
if (require.main === module) {
  main().catch((error) => {
    console.error(colorize('Unexpected error:', 'red'), error);
    process.exit(1);
  });
}

module.exports = { performReview, getDiff, getChangedFiles };
