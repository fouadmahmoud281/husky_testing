# AI Code Review Script

This script uses OpenAI's GPT-4o model to review code changes and provide categorized recommendations about code quality.

## Features

- **Git Integration**: Automatically detects code changes using git diff
- **Separate Analysis**: Analyzes deletions and additions separately
- **Multiple Review Types**: Supports pre-commit and pre-push reviews
- **Categorized Feedback**: Uses specific categories for different types of issues
- **Smart Blocking**: Only blocks for build-breaking issues

## Review Categories

The AI provides feedback in these specific categories:

- 🚨 **Syntax & Build Issues**: Missing semicolons, import errors, TypeScript errors
- 🛡 **Security Critical**: Hardcoded secrets, API keys, obvious vulnerabilities  
- 🎨 **Style Violations**: Major linting errors, formatting issues
- 🚫 **Blocking Issues**: Only build-breaking issues that prevent compilation/execution

## Blocking Behavior

- **Non-blocking**: 🛡 Security, 🎨 Style issues (warnings only)
- **Blocking**: 🚫 Issues that would break the build or prevent code execution
- **API Failures**: Script continues if OpenAI API is unavailable

## Setup

1. Make sure you have an OpenAI API key
2. Add your API key to the `.env` file:
   ```
   OPENAI_API_KEY=your_api_key_here
   ```

## Usage

The script is automatically triggered by Husky hooks:

- **Pre-push**: `npm run ai-unified` or directly via git push
- **Manual review**: `node scripts/ai-unified-review.js`

## Review Types

- `prepush` (default): Reviews changes between current branch and origin
- `precommit`: Reviews staged changes only

## Configuration

- **Model**: GPT-4o for enhanced code analysis
- **Max Tokens**: 1000 tokens for response
- **Temperature**: 0.1 for consistent, focused responses
- **Limits**: Max 50 additions/deletions per review to avoid token limits
