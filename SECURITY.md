# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in OneBun, please report it responsibly.

**Do NOT open a public issue for security vulnerabilities.**

Instead, please send an email or use GitHub's private vulnerability reporting feature.

### What to Include

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

### Response Timeline

- **Initial response**: Within 48 hours
- **Status update**: Within 7 days
- **Fix timeline**: Depends on severity

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |

## Security Best Practices

When using OneBun in your projects:

1. **Environment Variables**: Never commit `.env` files with real credentials
2. **Dependencies**: Regularly update dependencies to patch known vulnerabilities
3. **Authentication**: Use strong secrets for JWT and API keys
4. **Input Validation**: Always validate user input using the built-in validation
