const SECTION_RE = /^\|\s+(.+?)\s+\|$/;
const KV_RE = /^\s+([A-Za-z][A-Za-z0-9 _-]+?)\s*:\s*(.*?)\s*$/;

export function parseDsreg(text) {
  const sections = [];
  let current = null;
  for (const rawLine of text.split('\n')) {
    const l = rawLine.replace(/\r/g, '');
    if (/^\+[-+]+\+$/.test(l.trim())) continue;
    const sm = SECTION_RE.exec(l);
    if (sm) {
      if (current) sections.push(current);
      current = { title: sm[1].trim(), pairs: [] };
      continue;
    }
    const kvm = KV_RE.exec(l);
    if (kvm && current) {
      const key = kvm[1].trim();
      const val = kvm[2].trim();
      if (key && !/^[-=+]+$/.test(key)) current.pairs.push({ key, value: val });
    }
  }
  if (current && current.pairs.length) sections.push(current);
  return sections;
}

export function buildFacts(sections) {
  const facts = {};
  for (const s of sections) {
    for (const p of s.pairs) {
      facts[p.key.replace(/\s+/g, '').toLowerCase()] = p.value;
    }
  }
  return facts;
}

export function boolFact(v) {
  if (!v) return null;
  return /^yes|true|1$/i.test(v.trim());
}

export function analyzeIssues(facts) {
  const issues = [];
  const add = (sev, title, desc, fix) => issues.push({ sev, title, desc, fix });

  const aadJoined = boolFact(facts['azureadjoinedstatus'] || facts['azureadjoinedtype'] || facts['azureadjoined']);
  const domJoined = boolFact(facts['domainjoined']);
  const wpJoined  = boolFact(facts['workplacejoined']);
  const prt       = boolFact(facts['azureadprt']);
  const mdmUrl    = facts['mdmurl'] || facts['mdmcomplianceurl'] || facts['devicemanagementurl'] || '';
  const certExp   = facts['certificateexpiry'] || facts['certexpiry'] || '';
  const tenantId  = facts['tenantid'] || '';
  const deviceId  = facts['deviceid'] || '';
  const prtUpdate = facts['azureadprtupdatetime'] || '';

  if (aadJoined === false && domJoined === false && wpJoined === false) {
    add('error', 'Device not joined to any directory',
      'The device is not Azure AD joined, domain joined, or workplace joined.',
      'Run dsregcmd /join or enroll via Settings > Accounts > Access work or school.');
  } else if (aadJoined === false && domJoined === true) {
    add('warning', 'Hybrid Azure AD join may not be complete',
      'Device is domain joined but AzureAdJoined = NO. Hybrid join may be pending or failed.',
      'Check the Microsoft Entra Connect sync status, and ensure the computer object is synced. Review the user device registration event log.');
  } else if (aadJoined === false && !domJoined) {
    add('error', 'Device is not Azure AD joined',
      'AzureAdJoined is NO. Users will not receive AAD-backed SSO or Intune policies.',
      'Enroll device via Settings > Accounts > Access work or school, or re-run Azure AD join from the Out-of-Box Experience.');
  }

  if (prt === false) {
    add('error', 'No Azure AD Primary Refresh Token (PRT)',
      'AzureAdPrt = NO means users cannot get SSO tokens for Azure AD resources.',
      'Sign out and back in. If persistent, check network access to login.microsoftonline.com. Run: dsregcmd /refreshprt');
  } else if (prt === true && prtUpdate) {
    try {
      const ageHrs = (Date.now() - new Date(prtUpdate).getTime()) / 3600000;
      if (ageHrs > 4 && ageHrs < 8760) {
        add('warning', 'Azure AD PRT may be stale',
          `PRT last updated ${Math.round(ageHrs)} hours ago. Expected renewal every ~1 hour when online.`,
          'Ensure the device is connected to the internet and can reach login.microsoftonline.com.');
      }
    } catch { /**/ }
  }

  if (!mdmUrl || mdmUrl === 'null' || mdmUrl === '-') {
    if (aadJoined === true) {
      add('warning', 'Device not enrolled in MDM',
        'No MDM URL detected. The device is Azure AD joined but may not be Intune-managed.',
        'Enroll via Settings > Accounts > Access work or school > Enroll only in device management, or check auto-enrollment policy in Entra ID.');
    }
  }

  if (certExp && certExp !== 'N/A' && certExp !== '-') {
    try {
      const daysLeft = Math.round((new Date(certExp) - Date.now()) / 86400000);
      if (daysLeft < 0) {
        add('error', 'Device certificate has expired',
          `The device certificate expired ${Math.abs(daysLeft)} day(s) ago (${certExp}).`,
          'Re-join the device to Azure AD, or use a certificate renewal GPO/Intune policy.');
      } else if (daysLeft < 30) {
        add('warning', 'Device certificate expiring soon',
          `Certificate expires in ${daysLeft} day(s) (${certExp}).`,
          'Ensure certificate auto-renewal is enabled or manually renew before expiry.');
      }
    } catch { /**/ }
  }

  if (aadJoined === true && (!deviceId || deviceId === 'N/A' || deviceId === '-')) {
    add('warning', 'Device ID is missing',
      'Device appears Azure AD joined but no Device ID was found in the output.',
      'The device may have failed to register. Try re-joining or check Entra ID > Devices.');
  }

  if (aadJoined === true && (!tenantId || tenantId === 'N/A' || tenantId === '-')) {
    add('warning', 'Tenant ID is missing',
      'No Tenant ID found in dsregcmd output.',
      'This may indicate a partial or failed join. Re-run dsregcmd /status as the affected user.');
  }

  if (wpJoined === true && aadJoined !== true) {
    add('info', 'Workplace joined (BYOD registration)',
      'Device is workplace-joined (BYOD/MAM) but not fully Azure AD joined.',
      'This is expected for personal devices. For corporate devices, perform a full Azure AD join.');
  }

  if (!issues.length && aadJoined === true && prt === true) {
    add('info', 'Device registration looks healthy',
      'AzureAdJoined = YES and PRT is present. No obvious issues detected.',
      'Continue monitoring via the User Device Registration event log if issues are reported.');
  }

  return issues;
}
