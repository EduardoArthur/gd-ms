# Contributing to GEMS

GEMS uses Node.js 20 or newer. Use the local CLI and package checks to verify changes before opening a pull request.

## How to Contribute

### Reporting Bugs

1. Check if the bug has already been reported in [Issues](https://github.com/EduardoArthur/GEMS/issues)
2. If not, create a new issue with:
   - Clear title and description
   - Steps to reproduce
   - Expected vs actual behavior
   - Environment details (OS, Node version, etc.)

### Suggesting Features

1. Check existing [Issues](https://github.com/EduardoArthur/GEMS/issues) for similar suggestions
2. Create a new issue with:
   - Clear description of the feature
   - Use case and benefits
   - Possible implementation approach

### Pull Requests

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make your changes
4. Run `npm test` and `npm run validate:schemas`.
5. Run `npm run lint` and `npm run test:package`.
6. Commit with clear messages
7. Push and create a Pull Request

## Development Setup

```bash
npm install
npm start -- --help
```

See the [packaging guide](docs/NPM-PUBLISH-GUIDE.md) to exercise the distribution in a destination project.

## Code Style

- Use ES Modules (import/export)
- Follow ESLint configuration
- Use Prettier for formatting
- Write clear comments for complex logic
- Use meaningful variable names

## Commit Messages

Use conventional commits:

- `feat:` New feature
- `fix:` Bug fix
- `docs:` Documentation
- `style:` Formatting
- `refactor:` Code refactoring
- `test:` Tests
- `chore:` Maintenance

Example: `feat: add UE5 architect agent`

## Project Structure

```
gd-ks/
├── bin/           # CLI executables
├── src/
│   ├── cli/       # CLI commands
│   ├── core/      # Core system
│   └── modules/   # Feature modules
├── tools/
│   ├── installer/ # Installation system
│   └── compiler/  # Agent compiler
├── docs/          # Documentation
└── samples/       # Example projects
```

## Questions?

Feel free to open an issue for any questions.

Thank you for contributing! 🎮
