# Salesforce Permission Analyzer

**Understand, analyze, and modernize your Salesforce permission model.**

This tool helps Salesforce administrators:
- Trace permission sources for any user (Profile → Permission Set → Permission Set Group)
- Identify redundant and overlapping permissions
- Plan migration from profile-based to permission set-based security
- Export permission data for analysis and reporting

---

## Prerequisites

- **Node.js** v18+ ([download](https://nodejs.org/))
- **Salesforce CLI** ([install guide](https://developer.salesforce.com/tools/salesforcecli))
- Authenticated Salesforce org (`sf org login web` or `sf org login jwt`)

---

## Installation

### Option 1: Global Install (Recommended for usage)

```bash
npm install -g sf-permission-analyzer
sf-perm --help
```

### Option 2: Local Development

```bash
git clone <repo-url>
cd sf-permission-analyzer
npm install
npm link  # Makes 'sf-perm' command available globally
```

---

## Quick Start

### 1. Parse Permissions from Your Org

Retrieve and parse all permission metadata into a local database:

```bash
sf-perm parse --org my-sandbox --db ./permissions.db --full
```

**Options:**
- `--org <alias>` - Salesforce org alias or username
- `--db <path>` - Database file path (default: `./permissions.db`)
- `--metadata-dir <path>` - Where to store retrieved metadata (default: `./metadata`)
- `--full` - Retrieve metadata from org (omit to parse existing metadata only)

### 2. Trace Permission Sources

Find where a user gets a specific permission:

```bash
sf-perm trace \
  --user andrew.johnson@example.com \
  --permission Account.Edit \
  --db ./permissions.db \
  --verbose
```

**Example Output:**

```
User: andrew.johnson@example.com
Permission: Account.Edit

✓ Permission granted by 2 source(s):

1. Profile: Standard User
   Value: true

2. PermissionSet: Sales Operations
   → PermissionSetGroup: Sales Team
   → PermissionSet: Sales Operations
   Value: Edit
```

**Options:**
- `-u, --user <email>` - User email, username, or Salesforce ID (required)
- `-p, --permission <name>` - Permission name (required)
- `--format <type>` - Output format: `table` (default) or `json`
- `--verbose` - Show full permission chain (PSG → PS → Permission)

### 3. Export Database

Export the entire permission database to JSON for external analysis:

```bash
sf-perm export \
  --db ./permissions.db \
  --output ./permissions-export.json \
  --format json
```

---

## Permission Name Format

Use these formats when tracing permissions:

| Permission Type | Format | Example |
|----------------|--------|---------|
| Object CRUD | `Object.Action` | `Account.Edit`, `Contact.Delete` |
| Field-Level Security | `Object.Field` | `Account.Industry`, `Contact.Email` |
| System Permission | Permission name | `ManageUsers`, `ViewAllData` |
| Apex Class | `ApexClass:ClassName` | `ApexClass:MyController` |
| Custom Permission | Custom permission name | `MyCustomPermission` |

---

## Architecture

```
Salesforce Org
    ↓ (sf project retrieve start)
Raw Metadata XML
    ↓ (parse command)
SQLite Database (permissions.db)
    ↓ (trace/export commands)
Query Results / Exported Data
```

**Database Schema:**
- `profiles` - Profile metadata
- `permission_sets` - Permission Set metadata
- `permission_set_groups` - Permission Set Group metadata
- `psg_members` - PSG → PS membership mapping
- `permissions` - All permissions extracted from profiles/PS
- `user_assignments` - User → Profile/PS/PSG assignments

---

## Use Cases

### Migration Planning: Profile → Permission Sets

**Goal:** Move away from profile-based security to permission set-based.

1. Parse current state: `sf-perm parse --full`
2. For each permission in profiles, trace which users depend on it
3. Create new permission sets to replace profile permissions
4. Assign permission sets to users
5. Remove permissions from profiles

### Finding Redundant Permissions

**Goal:** Identify overlapping permissions to simplify your security model.

1. Export database: `sf-perm export --output data.json`
2. Analyze permissions granted by both Profile AND Permission Set
3. Remove redundant grants

### User Access Audit

**Goal:** Understand what access a user has and why.

1. Trace critical permissions: `sf-perm trace --user <email> --permission <perm> --verbose`
2. Review all sources (profile, direct PS, PSG → PS)
3. Document findings for compliance/security review

---

## Development

### Project Structure

```
src/
├── lib/
│   ├── retriever.js      # SF CLI wrapper (metadata retrieval, SOQL)
│   ├── parser.js         # XML → structured data
│   ├── database.js       # SQLite operations
│   └── tracer.js         # Permission resolution logic
├── commands/
│   ├── parse.js          # Parse command implementation
│   ├── trace.js          # Trace command implementation
│   └── export.js         # Export command implementation
└── index.js              # CLI entry point
```

### Running Tests

```bash
npm test
```

### Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development guidelines.

---

## Roadmap

**Phase 1: Discovery & Tracing** (Current)
- ✅ Metadata retrieval
- ✅ XML parsing
- ✅ Permission tracing
- ✅ CLI interface

**Phase 2: Redundancy Analysis**
- [ ] Compare permissions across profiles/PS
- [ ] Identify overlapping grants
- [ ] Generate consolidation recommendations

**Phase 3: Migration Planning**
- [ ] Design target permission architecture
- [ ] Generate metadata for new PS/PSG structure
- [ ] Create deployment packages

---

## Troubleshooting

### "Cannot find module" errors

Make sure dependencies are installed:

```bash
npm install
```

### "Org not found" errors

Ensure you're authenticated to the Salesforce org:

```bash
sf org list
sf org login web --alias my-sandbox
```

### Empty database after parsing

Check that metadata was retrieved successfully:

```bash
ls -la ./metadata/profiles/
ls -la ./metadata/permissionsets/
```

---

## License

MIT - See [LICENSE](LICENSE) file.

---

## Questions?

- **GitHub Issues:** [Create an issue](https://github.com/yourusername/sf-permission-analyzer/issues)
- **Documentation:** [Full docs](https://github.com/yourusername/sf-permission-analyzer/wiki)
