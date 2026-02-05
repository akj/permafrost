# Permission Modernization - Phase 1: Discovery & Tracing

**Project:** Salesforce Permission Model Modernization  
**Phase:** 1 - Permission Inventory & Tracer  
**Owner:** Andrew Johnson  
**Created:** 2026-02-05  

---

## Executive Summary

Build tooling to understand the current permission architecture by creating a queryable inventory of all permissions and their sources. Answer the fundamental question: **"Where does User X get Permission Y?"**

This phase establishes the foundation for subsequent analysis and migration work.

---

## Goals

1. **Retrieve** all permission metadata (Profiles, Permission Sets, Permission Set Groups)
2. **Parse** XML metadata into structured, queryable format
3. **Map** user assignments (User → Profile, User → PS, User → PSG)
4. **Trace** permission sources for any user/permission combination
5. **Export** data for analysis and reporting

---

## Technical Architecture

### Data Flow

```
Salesforce Org
    ↓ (sf CLI metadata retrieval)
Raw Metadata XML
    ↓ (parse-permissions.js)
Structured Permission Database (SQLite)
    ↓ (trace-permission.js)
Query Results
```

### Tech Stack

- **Node.js** - Runtime environment
- **Salesforce CLI** - Metadata retrieval and SOQL queries
- **fast-xml-parser** - Parse Salesforce metadata XML
- **better-sqlite3** - Local database for permission data
- **chalk** - CLI output formatting
- **commander** - CLI argument parsing

### Directory Structure

```
~/sf/bulkflows/
├── scripts/
│   └── permissions/
│       ├── lib/
│       │   ├── retriever.js      # SF CLI wrapper for metadata/SOQL
│       │   ├── parser.js         # XML → structured data
│       │   ├── database.js       # SQLite schema & queries
│       │   └── tracer.js         # Permission resolution logic
│       ├── parse-permissions.js  # Main: Build permission DB
│       ├── trace-permission.js   # CLI: Query permission sources
│       ├── export-data.js        # Export DB to JSON/CSV
│       └── package.json          # Dependencies
├── data/
│   └── permissions/
│       ├── metadata/             # Retrieved XML (gitignored)
│       ├── permissions.db        # SQLite database (gitignored)
│       └── assignments.json      # Cached user assignments
└── permplan.md                   # This file
```

---

## Data Model

### SQLite Schema

#### `profiles`
```sql
CREATE TABLE profiles (
    id TEXT PRIMARY KEY,
    full_name TEXT NOT NULL,
    user_license TEXT,
    is_custom BOOLEAN
);
```

#### `permission_sets`
```sql
CREATE TABLE permission_sets (
    id TEXT PRIMARY KEY,
    full_name TEXT NOT NULL,
    label TEXT,
    is_owned_by_profile BOOLEAN,
    license TEXT
);
```

#### `permission_set_groups`
```sql
CREATE TABLE permission_set_groups (
    id TEXT PRIMARY KEY,
    full_name TEXT NOT NULL,
    label TEXT,
    status TEXT
);
```

#### `psg_members`
```sql
CREATE TABLE psg_members (
    psg_id TEXT NOT NULL,
    ps_id TEXT NOT NULL,
    FOREIGN KEY (psg_id) REFERENCES permission_set_groups(id),
    FOREIGN KEY (ps_id) REFERENCES permission_sets(id)
);
```

#### `permissions`
```sql
CREATE TABLE permissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_type TEXT NOT NULL, -- 'Profile' | 'PermissionSet'
    source_id TEXT NOT NULL,
    permission_type TEXT NOT NULL, -- 'ObjectPermission' | 'FieldPermission' | 'ApexClassAccess' | 'SystemPermission' | etc.
    permission_name TEXT NOT NULL, -- e.g., 'Account.Edit', 'ManageUsers', 'ApexClass:MyController'
    permission_value TEXT, -- 'true' | 'Edit' | 'Read' | etc.
    FOREIGN KEY (source_id) REFERENCES profiles(id) OR permission_sets(id)
);
CREATE INDEX idx_permission_lookup ON permissions(permission_name, source_id);
```

#### `user_assignments`
```sql
CREATE TABLE user_assignments (
    user_id TEXT NOT NULL,
    assignee_type TEXT NOT NULL, -- 'Profile' | 'PermissionSet' | 'PermissionSetGroup'
    assignee_id TEXT NOT NULL,
    assignment_id TEXT, -- PermissionSetAssignment Id (null for profile)
    PRIMARY KEY (user_id, assignee_type, assignee_id)
);
CREATE INDEX idx_user_lookup ON user_assignments(user_id);
```

---

## Implementation Plan

### Step 1: Setup (30 min)

**Tasks:**
- Create `scripts/permissions/` directory structure
- Initialize `package.json` with dependencies
- Install: `fast-xml-parser`, `better-sqlite3`, `chalk`, `commander`
- Create placeholder files for all scripts

**Deliverables:**
- Working Node.js project structure
- All dependencies installed

**Validation:**
```bash
cd ~/sf/bulkflows/scripts/permissions
npm install
node --version # Verify Node.js works
```

---

### Step 2: Metadata Retrieval (1 hour)

**Tasks:**
- Write `lib/retriever.js`:
  - `retrieveProfiles()` - calls `sf project retrieve start --metadata Profile`
  - `retrievePermissionSets()` - calls `sf project retrieve start --metadata PermissionSet`
  - `retrievePermissionSetGroups()` - calls `sf project retrieve start --metadata PermissionSetGroup`
  - `queryUserAssignments()` - SOQL query for `PermissionSetAssignment`
  - `queryUsers()` - Get user list with profile assignments

**SOQL Queries:**
```sql
-- User assignments to PS/PSG
SELECT Id, AssigneeId, Assignee.Username, PermissionSetId, PermissionSet.Name, 
       PermissionSetGroupId, PermissionSetGroup.DeveloperName
FROM PermissionSetAssignment
WHERE Assignee.IsActive = true

-- User profiles
SELECT Id, Username, ProfileId, Profile.Name, IsActive
FROM User
WHERE IsActive = true
```

**Deliverables:**
- `lib/retriever.js` with all retrieval functions
- Retrieved metadata stored in `data/permissions/metadata/`

**Validation:**
```bash
node -e "require('./lib/retriever').retrieveProfiles()"
ls ~/sf/bulkflows/data/permissions/metadata/profiles/
```

---

### Step 3: XML Parser (2 hours)

**Tasks:**
- Write `lib/parser.js`:
  - `parseProfile(xmlPath)` - Extract permissions from Profile XML
  - `parsePermissionSet(xmlPath)` - Extract permissions from Permission Set XML
  - `parsePermissionSetGroup(xmlPath)` - Extract member PS from PSG XML
  - Generic helper: `extractPermissions(xmlObj)` - normalize different permission types

**Permission Types to Extract:**
- `applicationVisibilities` → App access
- `classAccesses` → Apex class access
- `customMetadataTypeAccesses` → Custom metadata access
- `customPermissions` → Custom permissions
- `fieldPermissions` → Field-level security
- `objectPermissions` → Object CRUD
- `pageAccesses` → Visualforce page access
- `recordTypeVisibilities` → Record type access
- `tabSettings` → Tab visibility
- `userPermissions` → System permissions (e.g., ManageUsers)

**Normalization Example:**
```javascript
// Input: <objectPermissions><object>Account</object><allowCreate>true</allowCreate></objectPermissions>
// Output: { type: 'ObjectPermission', name: 'Account.Create', value: 'true' }

// Input: <fieldPermissions><field>Account.Industry</field><readable>true</readable></fieldPermissions>
// Output: { type: 'FieldPermission', name: 'Account.Industry', value: 'Read' }
```

**Deliverables:**
- `lib/parser.js` with parsing functions for all metadata types
- Unit tests for parser (optional but recommended)

**Validation:**
```bash
node -e "console.log(require('./lib/parser').parseProfile('../../data/permissions/metadata/profiles/Admin.profile'))"
```

---

### Step 4: Database Layer (1.5 hours)

**Tasks:**
- Write `lib/database.js`:
  - `initDatabase(dbPath)` - Create SQLite DB with schema
  - `insertProfile(profileData)` - Insert profile record
  - `insertPermissionSet(psData)` - Insert permission set record
  - `insertPermissionSetGroup(psgData)` - Insert PSG record
  - `insertPermissions(permissions)` - Bulk insert permissions
  - `insertUserAssignments(assignments)` - Insert user assignments
  - `query(sql, params)` - Generic query wrapper

**Schema Creation:**
- Implement all tables from Data Model section above
- Add indexes for performance
- Add foreign key constraints

**Deliverables:**
- `lib/database.js` with full CRUD operations
- `data/permissions/permissions.db` created on first run

**Validation:**
```bash
node -e "require('./lib/database').initDatabase('../../data/permissions/permissions.db')"
sqlite3 ~/sf/bulkflows/data/permissions/permissions.db ".schema"
```

---

### Step 5: Permission Tracer Logic (2 hours)

**Tasks:**
- Write `lib/tracer.js`:
  - `traceUserPermission(userId, permissionName)` - Main tracer function
  - `resolveUserSources(userId)` - Get all permission sources for user (profile, PS, PSG → PS)
  - `checkPermissionInSource(sourceId, permissionName)` - Check if permission exists
  - `expandPSGChain(psgId)` - Recursively expand PSG → PS members

**Logic Flow:**
```
1. Get user assignments (profile + direct PS + PSG assignments)
2. For PSG assignments, expand to member PS
3. For each source (profile, PS):
   a. Check exact match on permission name
   b. Check wildcard/parent permissions (e.g., Account.* includes Account.Edit)
4. Return all sources that grant the permission
```

**Permission Matching Rules:**
- Exact match: `Account.Edit` == `Account.Edit`
- Field FLS implies read: `Account.Industry.Edit` implies `Account.Industry.Read`
- Object CRUD implies field read: `Account.Read` implies `Account.*.Read` (if FLS not explicitly denied)

**Deliverables:**
- `lib/tracer.js` with permission resolution logic
- Support for inheritance/wildcarding

**Validation:**
```javascript
const { traceUserPermission } = require('./lib/tracer');
const sources = traceUserPermission('005...', 'Account.Edit');
console.log(sources);
// Expected: [{ sourceType: 'Profile', sourceName: 'Standard User', grants: true }, ...]
```

---

### Step 6: CLI Interface (1.5 hours)

**Tasks:**
- Write `parse-permissions.js`:
  - Main script to orchestrate retrieval → parsing → DB population
  - Options: `--full` (retrieve + parse), `--parse-only` (parse existing metadata)
  - Progress indicators for long operations

- Write `trace-permission.js`:
  - CLI tool to query permission sources
  - Options:
    - `--user <email|username|id>` - User to trace
    - `--permission <permission>` - Permission name (e.g., `Account.Edit`)
    - `--format <table|json>` - Output format
    - `--verbose` - Show full chain (PSG → PS → permission)

- Write `export-data.js`:
  - Export entire DB to JSON or CSV for external analysis
  - Options: `--format <json|csv>` `--output <path>`

**Example Usage:**
```bash
# Build permission database
node parse-permissions.js --full

# Trace specific permission
node trace-permission.js --user "andrew.johnson@example.com" --permission "Account.Edit"

# Export all data
node export-data.js --format json --output ../../data/permissions/export.json
```

**Deliverables:**
- Three working CLI scripts with argument parsing
- Color-coded output (granted=green, denied=red, not found=yellow)
- Progress bars for long operations

**Validation:**
```bash
cd ~/sf/bulkflows/scripts/permissions
node parse-permissions.js --full
node trace-permission.js --user "andrew.johnson@blindit.org.austinpoc" --permission "Account.Read"
```

---

### Step 7: Documentation & Testing (1 hour)

**Tasks:**
- Write `README.md` in `scripts/permissions/` with:
  - Installation instructions
  - Usage examples
  - Troubleshooting tips
- Test against real org data:
  - Run full parse
  - Trace 5-10 different permissions for different users
  - Validate results manually in Salesforce Setup
- Create `.gitignore` for `data/permissions/` (exclude DB and metadata)

**Deliverables:**
- Complete README.md
- Validated tool against production org
- Confirmed accuracy of permission tracing

---

## Success Criteria

**Phase 1 is complete when:**

✅ All metadata retrieved and parsed into SQLite database  
✅ User assignments mapped (profile + PS + PSG)  
✅ CLI tool answers "Where does User X get Permission Y?" accurately  
✅ Output includes full chain: User → PSG → PS → Permission  
✅ Tool handles PSG nesting (if applicable)  
✅ Export functionality works for external analysis  
✅ Documentation complete and tested by another user  

---

## Estimated Timeline

| Step | Description | Time |
|------|-------------|------|
| 1 | Setup | 0.5 hrs |
| 2 | Metadata Retrieval | 1 hr |
| 3 | XML Parser | 2 hrs |
| 4 | Database Layer | 1.5 hrs |
| 5 | Tracer Logic | 2 hrs |
| 6 | CLI Interface | 1.5 hrs |
| 7 | Documentation & Testing | 1 hr |
| **Total** | | **~10 hours** |

Contingency: +20% for debugging/edge cases = **~12 hours total**

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Large org (1000+ PS) causes slow parsing | High | Add caching, incremental updates, progress bars |
| PSG circular references | Medium | Track visited PSGs, detect cycles |
| Complex permission inheritance rules | High | Start with simple cases, iterate with real examples |
| XML schema changes across API versions | Low | Test against API 65.0, document version |
| SF CLI auth expires during long retrieval | Medium | Add retry logic, check auth before operations |

---

## Dependencies

**External:**
- Salesforce CLI (`sf`) installed and authenticated
- Node.js v18+ (for native fetch, better SQLite support)
- Active Salesforce org access

**Internal:**
- None (Phase 1 is foundation)

---

## Next Phases (Preview)

**Phase 2: Redundancy Analysis**
- Compare permissions across profiles/PS
- Identify overlaps and consolidation opportunities
- Generate redundancy report

**Phase 3: Migration Planning**
- Design target permission architecture
- Generate metadata for new PS/PSG structure
- Create deployment package and rollback plan

---

## Notes

- Keep database schema flexible for future enhancements (e.g., historical tracking)
- Consider web UI in future (Phase 2+) for non-technical users
- Export functionality enables integration with BI tools (Tableau, Power BI)
- This tooling could be open-sourced if no proprietary data included

---

## Questions to Resolve

1. Should we track historical changes (permission granted/revoked over time)? → **Decision: Not in Phase 1, defer to Phase 2**
2. How to handle inactive users? → **Decision: Exclude by default, add `--include-inactive` flag**
3. What level of permission granularity? (e.g., track individual field permissions vs. just object-level?) → **Decision: Track all levels, filter in queries**
4. Export format preferences? → **Decision: JSON primary, CSV optional**

---

## Appendix: Example Queries

**Find all users with a specific permission:**
```sql
SELECT DISTINCT u.user_id, u.assignee_type, u.assignee_id, p.permission_name
FROM user_assignments u
JOIN permissions p ON u.assignee_id = p.source_id
WHERE p.permission_name = 'Account.Edit';
```

**Find all permissions granted by a Permission Set:**
```sql
SELECT permission_type, permission_name, permission_value
FROM permissions
WHERE source_id = '0PS...'
ORDER BY permission_type, permission_name;
```

**Find all Permission Sets in a PSG:**
```sql
WITH RECURSIVE psg_chain AS (
  SELECT ps_id, psg_id, 0 as level
  FROM psg_members
  WHERE psg_id = '0PG...'
  UNION ALL
  SELECT m.ps_id, m.psg_id, p.level + 1
  FROM psg_members m
  JOIN psg_chain p ON m.psg_id = p.ps_id
)
SELECT DISTINCT ps.full_name, ps.label
FROM psg_chain pc
JOIN permission_sets ps ON pc.ps_id = ps.id;
```

---

**End of Phase 1 Plan**
