/**
 * Markdown reporter for analysis results
 * Generates human-readable report with aggregated views and observational framing
 */

/**
 * Generate markdown report from analysis results and aggregated data
 * @param {Object} analysisResults - Raw analysis output from analyzers
 * @param {Object} aggregated - Aggregated data from aggregateForReport()
 * @param {Object} [options={}] - Formatting options
 * @param {number} [options.limit=10] - Maximum items per section
 * @returns {string} Markdown formatted report
 */
export function generateMarkdownReport(analysisResults, aggregated, options = {}) {
  const limit = options.limit ?? 10;
  const timestamp = new Date().toISOString();
  let md = '';

  md += renderHeader(timestamp);
  md += renderExecutiveSummary(aggregated);
  md += renderProfilePSRedundancy(aggregated, analysisResults, limit);
  md += renderMultiplePSRedundancy(aggregated, analysisResults, limit);
  md += renderPSGRedundancy(aggregated, analysisResults);
  md += renderProfileDependency(aggregated, analysisResults, limit);
  md += renderOverlapAnalysis(aggregated, analysisResults, limit);
  md += renderPSGPatterns(analysisResults, limit);
  md += renderDependencyHealth(aggregated, analysisResults, limit);
  md += renderFooter();

  return md;
}

// --- Section Renderers ---

function renderHeader(timestamp) {
  return `# Salesforce Permission Analysis Report

**Generated:** ${timestamp}

---

`;
}

function renderExecutiveSummary(aggregated) {
  if (!aggregated?.executiveSummary) {
    return '## Analysis Summary\n\nNo summary data available.\n\n---\n\n';
  }

  let md = '## Analysis Summary\n\n';

  if (aggregated.executiveSummary.metrics?.length > 0) {
    md += '### Key Findings\n\n';
    md += '| Metric | Value | Context |\n';
    md += '|--------|-------|--------|\n';

    for (const metric of aggregated.executiveSummary.metrics) {
      md += `| **${esc(metric.label)}** | ${esc(String(metric.value))} | ${esc(metric.context)} |\n`;
    }
    md += '\n---\n\n';
  }

  if (aggregated.executiveSummary.findings?.length > 0) {
    md += '### Areas Worth Reviewing\n\n';
    aggregated.executiveSummary.findings.forEach((finding, idx) => {
      md += `${idx + 1}. **${esc(finding.title)}**\n`;
      md += `   - ${esc(finding.detail)}\n\n`;
    });
    md += '---\n\n';
  }

  return md;
}

function renderProfilePSRedundancy(aggregated, analysisResults, limit) {
  let md = '## Profile + Permission Set Redundancy\n\n';
  md += '**Question Answered:** Which profiles have design overlap with permission sets?\n\n';

  const summary = analysisResults.redundancy?.profile_ps_redundancy?.summary;
  const byProfile = aggregated.profilePSRedundancy?.byProfile || [];
  const byPS = aggregated.profilePSRedundancy?.byPS || [];
  const details = analysisResults.redundancy?.profile_ps_redundancy?.details || [];

  if (byProfile.length === 0 && details.length === 0) {
    md += 'No redundant permissions found between profiles and permission sets.\n\n';
    return md;
  }

  if (summary) {
    md += `**Summary:** ${summary.total_redundant_permissions} redundant permissions across ${summary.affected_users} users and ${summary.affected_permission_sets} permission sets\n\n`;
  }

  // Primary: Profile table
  if (byProfile.length > 0) {
    md += `**Profiles with Highest Permission Set Overlap (Top ${limit}):**\n\n`;
    md += '| Profile | Total Perms | Redundant Perms | Overlap % | Most Overlapping PS | Users Affected |\n';
    md += '|---------|-------------|-----------------|-----------|---------------------|----------------|\n';

    for (const row of byProfile.slice(0, limit)) {
      const topPS = row.topOverlappingPS
        .map(p => `${esc(p.ps)} (${p.count})`)
        .join(', ');
      md += `| ${esc(row.profile)} | ${row.totalPerms} | ${row.redundantPerms} | ${row.overlapPct}% | ${topPS} | ${row.usersAffected} |\n`;
    }
    md += '\n';
  }

  // Secondary: PS table
  if (byPS.length > 0) {
    md += '**Permission Sets Most Redundant with Profiles:**\n\n';
    md += '| Permission Set | Overlaps With (profiles) | Total Redundant Perms | Users Affected |\n';
    md += '|----------------|--------------------------|----------------------|----------------|\n';

    for (const row of byPS.slice(0, Math.floor(limit / 2))) {
      const profiles = row.overlappingProfiles
        .slice(0, 3)
        .map(p => `${esc(p.profile)} (${p.count})`)
        .join(', ');
      md += `| ${esc(row.ps)} | ${profiles} | ${row.totalRedundant} | ${row.usersAffected} |\n`;
    }
    md += '\n';
  }

  md += '**Considerations:**\n';
  md += '- Profiles with >50% overlap may have design issues worth reviewing\n';
  md += '- Check if overlapping PS are assigned to all/most users with the profile\n';
  md += '- High overlap + high user count = large impact if restructured\n\n';

  // Collapsible detail
  if (details.length > 0) {
    md += '<details>\n';
    md += `<summary>Show all ${details.length} redundant permissions</summary>\n\n`;
    md += '| Permission | User | Profile | Permission Sets | Value |\n';
    md += '|------------|------|---------|-----------------|-------|\n';
    for (const d of details) {
      const psList = d.permission_sets.map(ps => esc(ps)).join(', ');
      md += `| ${esc(d.permission)} | ${esc(d.user)} | ${esc(d.profile)} | ${psList} | ${esc(d.value)} |\n`;
    }
    md += '\n</details>\n\n';
  }

  return md;
}

function renderMultiplePSRedundancy(aggregated, analysisResults, limit) {
  let md = '## Multiple Permission Set Redundancy\n\n';
  md += '**Question Answered:** Which users have the most redundant permission set assignments?\n\n';

  const summary = analysisResults.redundancy?.multiple_ps_redundancy?.summary;
  const byUser = aggregated.multiplePSRedundancy?.byUser || [];
  const byPSPair = aggregated.multiplePSRedundancy?.byPSPair || [];
  const byPermission = aggregated.multiplePSRedundancy?.byPermission || [];

  if (byUser.length === 0) {
    md += 'No redundant permissions found across multiple permission sets.\n\n';
    return md;
  }

  if (summary) {
    md += `**Summary:** ${summary.total_redundant_permissions} redundant permissions across ${summary.affected_users} users\n\n`;
  }

  // Primary: User table
  md += `**Users with Highest Permission Set Overlap (Top ${limit}):**\n\n`;
  md += '| User | Redundant Perms | Total PS Assigned | Worst Overlapping PS Pairs | Redundancy Score |\n';
  md += '|------|-----------------|-------------------|----------------------------|------------------|\n';

  for (const row of byUser.slice(0, limit)) {
    const worstPair = row.worstPairs.length > 0
      ? `${esc(row.worstPairs[0].psA)} ↔ ${esc(row.worstPairs[0].psB)} (${row.worstPairs[0].shared} shared)`
      : 'N/A';
    md += `| ${esc(row.user)} | ${row.redundantPerms} | ${row.totalPS} | ${worstPair} | ${row.score} |\n`;
  }
  md += '\n';

  // PS pair table
  if (byPSPair.length > 0) {
    md += '**Most Overlapping Permission Set Pairs:**\n\n';
    md += '| PS A | PS B | Shared Perms | Users with Both |\n';
    md += '|------|------|--------------|----------------|\n';

    for (const row of byPSPair.slice(0, limit)) {
      md += `| ${esc(row.psA)} | ${esc(row.psB)} | ${row.sharedPerms} | ${row.usersWithBoth} |\n`;
    }
    md += '\n';
  }

  // Most redundantly granted permissions
  if (byPermission.length > 0) {
    md += '**Most Redundantly Granted Permissions:**\n\n';
    md += '| Permission | Granted By (PS count) | User Count |\n';
    md += '|------------|----------------------|------------|\n';

    for (const row of byPermission.slice(0, limit)) {
      const permName = row.permission.split('::')[0] || row.permission;
      md += `| ${esc(permName)} | ${row.psCount} | ${row.userCount} |\n`;
    }
    md += '\n';
  }

  md += '**Considerations:**\n';
  md += '- Users with many redundant permissions may have accumulated assignments over time\n';
  md += '- PS pairs with high shared permission counts may indicate opportunities for consolidation\n';
  md += '- Review if all assigned PS are still needed for each user\n\n';

  // Collapsible full user list
  if (byUser.length > limit) {
    md += '<details>\n';
    md += `<summary>Show all ${byUser.length} users sorted by redundancy</summary>\n\n`;
    md += '| User | Redundant Perms | Total PS | Score |\n';
    md += '|------|-----------------|----------|-------|\n';
    for (const row of byUser) {
      md += `| ${esc(row.user)} | ${row.redundantPerms} | ${row.totalPS} | ${row.score} |\n`;
    }
    md += '\n</details>\n\n';
  }

  return md;
}

function renderPSGRedundancy(aggregated, analysisResults) {
  let md = '## Permission Set Group Redundancy\n\n';
  md += '**Question Answered:** Which users have redundant direct PS assignments (already covered by their PSG)?\n\n';

  const summary = analysisResults.redundancy?.psg_redundancy?.summary;
  const byPSG = aggregated.psgRedundancy?.byPSG || [];
  const details = analysisResults.redundancy?.psg_redundancy?.details || [];

  if (byPSG.length === 0 && details.length === 0) {
    md += 'No redundant permission set group assignments found.\n\n';
    return md;
  }

  if (summary) {
    md += `**Summary:** ${summary.total_redundant_assignments} redundant assignments across ${summary.affected_users} users\n\n`;
  }

  md += '**Context:**\n';
  md += '- Users assigned to a PSG automatically receive all member PS permissions\n';
  md += '- Direct PS assignment in addition to PSG membership is redundant\n';
  md += '- Often caused by assignments made before PSG was created\n\n';

  // PSG-grouped table
  if (byPSG.length > 0) {
    md += '**Redundancy by Permission Set Group:**\n\n';
    md += '| PSG | Redundant Direct PS | User Count | Example Users |\n';
    md += '|-----|---------------------|------------|---------------|\n';

    for (const row of byPSG) {
      const redundantPS = row.redundantPS
        .map(p => `${esc(p.ps)} (${p.userCount} users)`)
        .join(', ');
      const examples = row.exampleUsers.slice(0, 3).map(u => esc(u)).join(', ');
      const suffix = row.totalUsers > 3 ? ` (+${row.totalUsers - 3} more)` : '';
      md += `| ${esc(row.psg)} | ${redundantPS} | ${row.totalUsers} | ${examples}${suffix} |\n`;
    }
    md += '\n';
  }

  md += '**Considerations:**\n';
  md += '- Verify direct PS doesn\'t serve specific purpose (audit, license requirement)\n';
  md += '- Safe to remove if no special requirements\n';
  if (byPSG.length > 0) {
    md += `- ${esc(byPSG[0].psg)} affects ${byPSG[0].totalUsers} users (highest impact)\n`;
  }
  md += '\n';

  // Collapsible detail
  if (details.length > 0) {
    md += '<details>\n';
    md += `<summary>Show all ${details.length} redundant assignments by user</summary>\n\n`;
    md += '| User | Permission Set Group | Direct Permission Sets |\n';
    md += '|------|----------------------|------------------------|\n';
    for (const d of details) {
      const redundantPS = d.redundant_ps.map(ps => esc(ps)).join(', ');
      md += `| ${esc(d.user)} | ${esc(d.psg)} | ${redundantPS} |\n`;
    }
    md += '\n</details>\n\n';
  }

  return md;
}

function renderProfileDependency(aggregated, analysisResults, limit) {
  let md = '## Profile Dependency Analysis\n\n';
  md += '**Question Answered:** Which profiles have the most unique permissions (not duplicated in any permission set)?\n\n';

  const summary = analysisResults.redundancy?.profile_only_permissions?.summary;
  const profileOnly = aggregated.profileOnly || [];

  if (profileOnly.length === 0) {
    md += 'No profile-only permissions found.\n\n';
    return md;
  }

  if (summary) {
    md += `**Summary:** ${summary.total_profile_only} profile-only permissions across ${summary.profiles_affected} profiles (${summary.percentage_profile_only}% of all profile permissions)\n\n`;
  }

  md += '**Context:**\n';
  md += '- Permissions granted ONLY by profiles indicate dependency on profile-based security\n';
  md += '- High unique perm count = more work required to migrate to permission-set-based model\n';
  md += '- Low unique perm count = profile already well-supported by existing PS\n\n';

  // Top N table
  md += `**Profiles by Unique Permission Count (Top ${limit}):**\n\n`;
  md += '| Rank | Profile | Unique Perms | % of Profile | Users | Migration Complexity |\n';
  md += '|------|---------|--------------|--------------|-------|----------------------|\n';

  for (const row of profileOnly.slice(0, limit)) {
    const icon = complexityIcon(row.complexity);
    md += `| ${row.rank} | ${esc(row.profile)} | ${row.uniquePerms} | ${row.pctOfProfile}% | ${row.userCount} | ${icon} ${row.complexity} |\n`;
  }
  md += '\n';

  // Complexity assessment
  const highCount = profileOnly.filter(p => p.complexity === 'High').length;
  const medCount = profileOnly.filter(p => p.complexity === 'Medium').length;
  const lowCount = profileOnly.filter(p => p.complexity === 'Low').length;

  md += '**Migration Complexity Assessment:**\n\n';
  md += '| Complexity | Criteria | Profile Count |\n';
  md += '|------------|----------|---------------|\n';
  md += `| 🔴 High | >100 unique perms OR >80% of profile | ${highCount} |\n`;
  md += `| 🟡 Medium | 30-100 unique OR 50-80% of profile | ${medCount} |\n`;
  md += `| 🟢 Low | <30 unique OR <50% of profile | ${lowCount} |\n\n`;

  if (profileOnly.length > limit) {
    md += `*Showing top ${limit} of ${profileOnly.length} profiles. Remaining profiles have fewer unique permissions.*\n\n`;

    md += '<details>\n';
    md += `<summary>Show all ${profileOnly.length} profiles sorted by unique permission count</summary>\n\n`;
    md += '| Rank | Profile | Unique Perms | % of Profile | Users | Complexity |\n';
    md += '|------|---------|--------------|--------------|-------|------------|\n';
    for (const row of profileOnly) {
      const icon = complexityIcon(row.complexity);
      md += `| ${row.rank} | ${esc(row.profile)} | ${row.uniquePerms} | ${row.pctOfProfile}% | ${row.userCount} | ${icon} ${row.complexity} |\n`;
    }
    md += '\n</details>\n\n';
  }

  return md;
}

function renderOverlapAnalysis(aggregated, analysisResults, limit) {
  let md = '## Permission Set Overlap Analysis\n\n';

  md += '**Context:** Measures how similar permission sets are to each other. High overlap may indicate:\n';
  md += '- Redundant permission sets serving similar purposes\n';
  md += '- Subset relationships (one PS contains all permissions of another)\n';
  md += '- Opportunities for consolidation via Permission Set Groups\n\n';

  md += '**Overlap Metric:**\n';
  md += '- **100%** = PS B contains all permissions in PS A (perfect subset)\n';
  md += '- **>80%** = Very high overlap, strong consolidation candidate\n';
  md += '- **50-80%** = Moderate overlap, may share functional area\n';
  md += '- **<50%** = Low overlap (excluded from this report)\n\n';

  const summary = analysisResults.overlap?.summary;
  const pairs = aggregated.overlapClassified || [];

  if (summary) {
    md += `**Summary:** ${summary.total_comparisons} comparisons, ${summary.high_overlap_pairs} pairs above threshold\n\n`;
  }

  if (pairs.length > 0) {
    md += '**High Overlap Pairs:**\n\n';
    md += '| Permission Set A | Permission Set B | Overlap | Relationship |\n';
    md += '|------------------|------------------|---------|--------------|\n';

    for (const pair of pairs.slice(0, limit)) {
      const psA = `${esc(pair.permission_set_a.name)} (${pair.permission_set_a.permission_count} perms)`;
      const psB = `${esc(pair.permission_set_b.name)} (${pair.permission_set_b.permission_count} perms)`;
      const overlap = `${(pair.metrics.overlap_percentage * 100).toFixed(1)}%`;
      md += `| ${psA} | ${psB} | ${overlap} | ${esc(pair.relationship)} |\n`;
    }
    md += '\n';

    if (pairs.length > limit) {
      md += `*Showing top ${limit} of ${pairs.length} overlapping pairs. See JSON export for complete data.*\n\n`;
    }

    md += '**Interpretation:**\n';
    md += '- **Near-perfect subsets (>95%):** Consider if smaller PS is needed when users have both\n';
    md += '- **High overlap (80-95%):** May indicate overlapping functional areas\n';
    md += '- **Moderate overlap (50-80%):** Review actual user assignments to determine if consolidation makes sense\n\n';
  } else {
    md += 'No overlapping permission set pairs found.\n\n';
  }

  md += '**Considerations:**\n';
  md += '- Overlap doesn\'t necessarily mean redundancy (different user populations may need similar access)\n';
  md += '- Some overlap may be intentional (e.g., base permissions duplicated across areas)\n\n';

  return md;
}

function renderPSGPatterns(analysisResults, limit) {
  let md = '## Permission Set Group Patterns\n\n';

  const psgRec = analysisResults.psg_recommendations || {};
  const hierarchical = psgRec.hierarchical?.recommendations || [];
  const coAssignment = psgRec.coAssignment?.recommendations || [];

  // Hierarchical
  md += '### Hierarchical Relationships Detected\n\n';
  md += '**Pattern:** Permission sets where one contains all permissions of another (subset relationships)\n\n';

  if (hierarchical.length > 0) {
    // ASCII tree for top entry
    const top = hierarchical[0];
    const members = top.recommendedPSG?.members || [];
    md += '```\n';
    md += `${top.basePermissionSet} (${top.basePermissionCount} permissions)\n`;
    const showMembers = members.slice(0, 4);
    showMembers.forEach((member, idx) => {
      const isLast = idx === showMembers.length - 1 && members.length <= 4;
      const prefix = isLast ? '└──' : '├──';
      md += `${prefix} Contains: ${member}\n`;
    });
    if (members.length > 4) {
      md += `    (+ ${members.length - 4} more)\n`;
    }
    md += '```\n\n';

    // Other hierarchies table
    md += '**Other Hierarchical Patterns:**\n\n';
    md += '| Base PS | Permission Count | Contains (subset count) |\n';
    md += '|---------|------------------|-------------------------|\n';
    for (const rec of hierarchical.slice(0, limit)) {
      md += `| ${esc(rec.basePermissionSet)} | ${rec.basePermissionCount} | ${rec.totalSubsets} smaller PS |\n`;
    }
    md += '\n';

    if (hierarchical.length > limit) {
      md += `*Showing top ${limit} of ${hierarchical.length} hierarchical patterns. See JSON export for complete data.*\n\n`;
    }

    md += '**Reviewing Hierarchies:**\n';
    md += '- Check if users receive both base PS and subset PS\n';
    md += '- Verify if subset PS serve distinct user populations\n';
    md += '- Consider PSG structure if same users receive multiple levels\n\n';
  } else {
    md += 'No hierarchical relationships detected.\n\n';
  }

  // Co-Assignment
  md += '### Frequently Co-Assigned Permission Sets\n\n';
  md += '**Pattern:** Permission sets that are often assigned together to the same users\n\n';

  if (coAssignment.length > 0) {
    md += '| Permission Sets in Bundle | Member Count | Assignments Saved per User |\n';
    md += '|---------------------------|--------------|----------------------------|\n';
    for (const rec of coAssignment.slice(0, limit)) {
      const members = rec.members?.map(m => esc(m)).join(', ') || '';
      md += `| ${members} | ${rec.member_count} | ${rec.estimated_reduction} |\n`;
    }
    md += '\n';

    if (coAssignment.length > limit) {
      md += `*Showing top ${limit} of ${coAssignment.length} co-assignment patterns. See JSON export for complete data.*\n\n`;
    }

    md += '**Reviewing Co-Assignments:**\n';
    md += '- Check if all users with pattern need all PS in bundle\n';
    md += '- Consider if pattern reflects job role or is accidental accumulation\n';
    md += '- Validate business logic before creating PSG\n\n';
  } else {
    md += 'No co-assignment patterns detected.\n\n';
  }

  return md;
}

function renderDependencyHealth(aggregated, analysisResults, limit) {
  let md = '## Dependency Health\n\n';
  md += '**Question Answered:** Are permission dependencies satisfied (e.g., field permissions require object Read)?\n\n';

  const dh = analysisResults.dependencyHealth;
  if (!dh || dh.no_dependency_rules || dh.no_permissions) {
    md += 'Dependency analysis not available. Run parse command to seed dependency rules.\n\n';
    return md;
  }

  const scoreLabel = dh.score >= 90 ? 'Good' : dh.score >= 70 ? 'Fair' : 'Poor';
  const scoreBadge = dh.score >= 90 ? '🟢' : dh.score >= 70 ? '🟡' : '🔴';

  md += `**Overall Score:** ${scoreBadge} ${dh.score}/100 (${scoreLabel})\n\n`;

  md += '### Summary\n\n';
  md += `- **Total Violations:** ${dh.summary.total_violations}\n`;
  md += `- **Errors:** ${dh.summary.by_severity.error}\n`;
  md += `- **Warnings:** ${dh.summary.by_severity.warning}\n`;
  md += `- **Info:** ${dh.summary.by_severity.info}\n`;
  md += `- **Sources Analyzed:** ${dh.summary.sources_analyzed}\n`;
  md += `- **Sources with Issues:** ${dh.summary.sources_with_issues}\n\n`;

  if (dh.findings.length > 0) {
    const bySource = new Map();
    for (const f of dh.findings) {
      if (!bySource.has(f.source_id)) {
        bySource.set(f.source_id, []);
      }
      bySource.get(f.source_id).push(f);
    }

    const displayLimit = limit || 5;
    const sortedSources = Array.from(bySource.entries())
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, displayLimit);

    md += `### Top ${displayLimit} Permission Sets by Violation Count\n\n`;
    md += '| Source | Violations | Example Issue |\n';
    md += '|--------|-----------|---------------|\n';
    for (const [source, findings] of sortedSources) {
      const exampleMsg = findings[0].message || 'N/A';
      md += `| ${esc(source)} | ${findings.length} | ${esc(exampleMsg)} |\n`;
    }
    md += '\n---\n\n';
  }

  return md;
}

function renderFooter() {
  return '---\n\n*For complete analysis data, export to JSON format.*\n';
}

// --- Helpers ---

function esc(text) {
  if (text === null || text === undefined) return '';
  return String(text).replace(/\|/g, '\\|');
}

function complexityIcon(complexity) {
  if (complexity === 'High') return '🔴';
  if (complexity === 'Medium') return '🟡';
  if (complexity === 'Low') return '🟢';
  return '';
}
