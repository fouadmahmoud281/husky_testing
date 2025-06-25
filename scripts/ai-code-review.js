const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// OpenAI configuration
const OpenAI = require('openai');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o';
const MAX_TOKENS = parseInt(process.env.MAX_TOKENS) || 1000;

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

function extractScore(review, category) {
  const regex = new RegExp(`\\*\\*${category}:\\*\\*\\s*\\[Score:\\s*(\\d+)/10\\]`, 'i');
  const match = review.match(regex);
  return match ? parseInt(match[1]) : 7; // Default score if not found
}

function getGitDiff() {
  try {
    // Get the diff between current branch and origin/main (or master)
    let baseBranch = 'origin/main';
    try {
      execSync('git rev-parse --verify origin/main', { stdio: 'pipe' });
    } catch {
      try {
        execSync('git rev-parse --verify origin/master', { stdio: 'pipe' });
        baseBranch = 'origin/master';
      } catch {
        // If no remote, compare with HEAD~1
        baseBranch = 'HEAD~1';
      }
    }

    const diff = execSync(`git diff ${baseBranch}...HEAD`, { encoding: 'utf8' });
    return diff;
  } catch (error) {
    console.error(colorize('Error getting git diff:', 'red'), error.message);
    return null;
  }
}

function getChangedFiles() {
  try {
    const files = execSync('git diff --name-only HEAD~1...HEAD', { encoding: 'utf8' });
    return files.trim().split('\n').filter(file => file.length > 0);
  } catch (error) {
    console.error(colorize('Error getting changed files:', 'red'), error.message);
    return [];
  }
}

async function reviewCode(diff, changedFiles) {
  if (!diff || diff.trim().length === 0) {
    console.log(colorize('No changes detected. Skipping AI review.', 'yellow'));
    return { success: true, recommendations: [] };
  }

  const prompt = `
You are a COMPREHENSIVE CODE REVIEWER for pre-push analysis. Perform a thorough multi-dimensional review of the changes.

🔍 **COMPREHENSIVE REVIEW CATEGORIES**:

**1. 🏗️ CODE QUALITY & ARCHITECTURE**
- SOLID principles adherence
- Design patterns usage
- Code complexity and maintainability
- Component structure and organization
- Dependency management

**2. ⚡ PERFORMANCE ANALYSIS**
- Algorithm efficiency
- Memory usage patterns
- Database query optimization
- Bundle size impact
- React rendering optimization

**3. 🛡️ SECURITY REVIEW**
- Authentication/authorization issues
- Data validation
- Input sanitization
- Dependency vulnerabilities
- Privacy concerns

**4. 🧪 TESTING & QUALITY ASSURANCE**
- Test coverage gaps
- Edge case handling
- Error handling patterns
- Mock usage appropriateness
- Test quality assessment

**5. 📚 DOCUMENTATION & ACCESSIBILITY**
- Code documentation completeness
- API documentation updates
- A11y compliance (WCAG)
- Screen reader compatibility
- Keyboard navigation

**6. ⚛️ REACT/FRONTEND SPECIFIC**
- Hook usage patterns
- State management efficiency
- Component lifecycle optimization
- Props validation
- Event handling patterns

**7. 🎯 BEST PRACTICES & STANDARDS**
- Industry standards compliance
- Framework best practices
- Naming conventions
- Code organization
- Scalability considerations

Changed files: ${changedFiles.join(', ')}

Git diff:
\`\`\`diff
${diff}
\`\`\`

**RESPONSE FORMAT:**
**OVERALL ASSESSMENT:** [EXCELLENT/GOOD/NEEDS_IMPROVEMENT/CRITICAL_ISSUES]

**📊 REVIEW SUMMARY:**
Brief overview of changes and general quality

**🔍 DETAILED ANALYSIS:**

**🏗️ CODE QUALITY:** [Score: /10]
- [HIGH/MEDIUM/LOW] Issue/Recommendation

**⚡ PERFORMANCE:** [Score: /10]  
- [HIGH/MEDIUM/LOW] Issue/Recommendation

**🛡️ SECURITY:** [Score: /10]
- [HIGH/MEDIUM/LOW] Issue/Recommendation

**🧪 TESTING:** [Score: /10]
- [HIGH/MEDIUM/LOW] Issue/Recommendation

**📚 DOCUMENTATION & A11Y:** [Score: /10]
- [HIGH/MEDIUM/LOW] Issue/Recommendation

**⚛️ REACT/FRONTEND:** [Score: /10]
- [HIGH/MEDIUM/LOW] Issue/Recommendation

**✅ POSITIVE HIGHLIGHTS:**
- Good practices observed

**🎯 ACTION ITEMS:**
1. [CRITICAL/HIGH/MEDIUM/LOW] Specific action needed
2. [CRITICAL/HIGH/MEDIUM/LOW] Specific action needed

Provide actionable, specific feedback with line references when possible.
`;

  try {
    console.log(colorize('🔍 Comprehensive AI pre-push review...', 'cyan'));
    
    const response = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        {
          role: 'system',
          content: 'You are a senior code reviewer and architect specializing in comprehensive code analysis across multiple dimensions: quality, performance, security, testing, documentation, and framework-specific best practices.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      max_tokens: MAX_TOKENS,
      temperature: 0.3,
    });

    const review = response.choices[0].message.content;
    console.log(colorize('\n📋 Comprehensive Pre-push Review Results:', 'bright'));
    console.log('=' .repeat(80));
    console.log(review);
    console.log('=' .repeat(80));

    // Parse assessment level - updated for new format
    const assessmentMatch = review.match(/\*\*OVERALL ASSESSMENT:\*\*\s*(EXCELLENT|GOOD|NEEDS_IMPROVEMENT|CRITICAL_ISSUES)/i);
    const assessment = assessmentMatch ? assessmentMatch[1].toUpperCase() : 'NEEDS_IMPROVEMENT';

    // Parse scores for detailed feedback
    const scores = {
      quality: extractScore(review, 'CODE QUALITY'),
      performance: extractScore(review, 'PERFORMANCE'),
      security: extractScore(review, 'SECURITY'),
      testing: extractScore(review, 'TESTING'),
      documentation: extractScore(review, 'DOCUMENTATION'),
      react: extractScore(review, 'REACT/FRONTEND')
    };

    // Calculate overall score
    const overallScore = Object.values(scores).reduce((a, b) => a + b, 0) / Object.keys(scores).length;

    // Determine blocking criteria
    const shouldBlock = assessment === 'CRITICAL_ISSUES' || 
                       scores.security < 6 || 
                       scores.quality < 5 ||
                       overallScore < 6;
    
    if (shouldBlock) {
      console.log(colorize('\n🚫 PUSH BLOCKED - Critical issues detected!', 'red'));
      console.log(colorize(`Overall Score: ${overallScore.toFixed(1)}/10`, 'red'));
      console.log(colorize('Address critical issues before pushing:', 'red'));
      if (scores.security < 6) console.log(colorize('- Security issues must be resolved', 'red'));
      if (scores.quality < 5) console.log(colorize('- Code quality is below acceptable threshold', 'red'));
    } else if (assessment === 'NEEDS_IMPROVEMENT' || overallScore < 7) {
      console.log(colorize('\n📝 Push allowed with recommendations', 'yellow'));
      console.log(colorize(`Overall Score: ${overallScore.toFixed(1)}/10`, 'yellow'));
      console.log(colorize('Consider addressing recommendations for better code quality.', 'yellow'));
    } else {
      console.log(colorize('\n✅ Excellent work! Push approved!', 'green'));
      console.log(colorize(`Overall Score: ${overallScore.toFixed(1)}/10`, 'green'));
    }

    return {
      success: !shouldBlock,
      assessment,
      review,
      scores,
      overallScore,
      recommendations: review.split('**🎯 ACTION ITEMS:**')[1]?.trim() || ''
    };

  } catch (error) {
    console.error(colorize('Error during AI review:', 'red'), error.message);
    
    if (error.message.includes('API key')) {
      console.error(colorize('\n🔑 Please set your OpenAI API key in the .env file:', 'yellow'));
      console.error(colorize('OPENAI_API_KEY=your_api_key_here', 'cyan'));
      console.error(colorize('\nCopy .env.example to .env and add your API key.', 'yellow'));
    }
    
    // Don't block push on API errors, just warn
    console.log(colorize('\n⚠️  AI review failed, but allowing push to continue.', 'yellow'));
    return { success: true, error: error.message };
  }
}

function saveReviewLog(review, changedFiles) {
  const logDir = path.join(process.cwd(), '.husky', 'logs');
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logFile = path.join(logDir, `pre-push-${timestamp}.md`);
  
  const logContent = `# Pre-push AI Code Review Log
**Date:** ${new Date().toLocaleString()}
**Type:** Pre-push Comprehensive Review
**Changed Files:** ${changedFiles.join(', ')}

${review.review || review.error || 'Review completed'}
`;

  fs.writeFileSync(logFile, logContent);
  console.log(colorize(`\n📝 Pre-push review log saved to: ${logFile}`, 'blue'));
}

async function main() {
  console.log(colorize('🚀 Pre-push AI Code Review (Comprehensive)...', 'bright'));
  
  // Check if OpenAI API key is configured
  if (!process.env.OPENAI_API_KEY) {
    console.error(colorize('❌ OPENAI_API_KEY not found in environment variables.', 'red'));
    console.error(colorize('Please copy .env.example to .env and add your OpenAI API key.', 'yellow'));
    process.exit(1);
  }

  const diff = getGitDiff();
  const changedFiles = getChangedFiles();

  if (!diff) {
    console.log(colorize('No git diff available. Skipping review.', 'yellow'));
    process.exit(0);
  }

  console.log(colorize(`📁 Changed files: ${changedFiles.join(', ')}`, 'blue'));
  
  const result = await reviewCode(diff, changedFiles);
  
  // Save review log
  saveReviewLog(result, changedFiles);
  
  if (!result.success) {
    process.exit(1);
  }
  
  console.log(colorize('\n🎉 Pre-push code review completed successfully!', 'green'));
}

// Run the main function
main().catch((error) => {
  console.error(colorize('Unexpected error:', 'red'), error);
  process.exit(1);
});
