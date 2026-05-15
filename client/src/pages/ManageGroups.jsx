import { useEffect, useState, useCallback } from 'react';
import {
  Users, UserPlus, UserMinus, CheckCircle, AlertCircle,
  Loader, RefreshCw, ShieldCheck, ChevronDown, KeyRound,
  Eye, EyeOff, X, UsersRound,
  UserRound,
} from 'lucide-react';
import {
  getConfig,
  getGroupMembers,
  verifyUser,
  addUserToGroup,
  removeUserFromGroup,
} from '../api';
import { useAdCredential } from '../context/AdCredentialContext';

export default function ManageGroups() {
  const { adUsername, setAdUsername, adPassword, setAdPassword, clear: clearCreds } = useAdCredential();

  const [groups, setGroups] = useState([]);
  const [groupFilter, setGroupFilter] = useState('');
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [members, setMembers] = useState([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [membersError, setMembersError] = useState('');

  // Credential panel
  const [credOpen, setCredOpen] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Add-user panel
  const [addUsername, setAddUsername] = useState('');
  const [addVerifying, setAddVerifying] = useState(false);
  const [addUserInfo, setAddUserInfo] = useState(null);
  const [addUserError, setAddUserError] = useState('');
  const [addConfirming, setAddConfirming] = useState(false);
  const [addResult, setAddResult] = useState('');

  // Remove confirmation
  const [removePending, setRemovePending] = useState(null);
  const [removeChecking, setRemoveChecking] = useState(false);
  const [removeError, setRemoveError] = useState('');

  // Load groups from config on mount
  useEffect(() => {
    getConfig()
      .then((cfg) => {
        const managed = cfg?.groups?.managedGroups || [];
        const sorted = [...managed].sort((a, b) => a.name.localeCompare(b.name));
        setGroups(sorted);
        if (sorted.length === 1) setSelectedGroup(sorted[0]);
      })
      .catch(() => { });
  }, []);

  // Filtered + already-sorted group list
  const filteredGroups = groupFilter.trim()
    ? groups.filter((g) =>
      // g.name.toLowerCase().startsWith(groupFilter.trim().toLowerCase())
      g.name.toLowerCase().includes(groupFilter.trim().toLowerCase(), 0)
    )
    : groups;

  // Build credential object for API calls (null when no username set)
  const credential = adUsername.trim()
    ? { adUsername: adUsername.trim(), adPassword }
    : null;

  const loadMembers = useCallback(
    async (group) => {
      if (!group) return;
      setLoadingMembers(true);
      setMembersError('');
      setMembers([]);
      setRemovePending(null);
      setAddResult('');
      try {
        const data = await getGroupMembers(group.name, group.type, credential);
        setMembers(data);
      } catch (err) {
        setMembersError(err.message);
      } finally {
        setLoadingMembers(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [adUsername, adPassword]
  );

  useEffect(() => {
    if (selectedGroup) loadMembers(selectedGroup);
  }, [selectedGroup, loadMembers]);

  const selectGroup = (group) => {
    setSelectedGroup(group);
    resetAddPanel();
    setRemovePending(null);
  };

  // ── Add user ───────────────────────────────────────────────────────────────

  const resetAddPanel = () => {
    setAddUsername('');
    setAddVerifying(false);
    setAddUserInfo(null);
    setAddUserError('');
    setAddConfirming(false);
    setAddResult('');
  };

  const handleVerifyUser = async () => {
    if (!addUsername.trim() || !selectedGroup) return;
    setAddVerifying(true);
    setAddUserInfo(null);
    setAddUserError('');
    setAddResult('');
    try {
      const info = await verifyUser(addUsername.trim(), selectedGroup.type, credential);
      if (!info.exists) {
        setAddUserError(info.error || `User "${addUsername.trim()}" not found.`);
      } else {
        const already = members.some(
          (m) =>
            m.samAccountName?.toLowerCase() === info.name?.toLowerCase() ||
            m.name?.toLowerCase().endsWith(`\\${info.name?.toLowerCase()}`) ||
            m.name?.toLowerCase() === info.name?.toLowerCase()
        );
        setAddUserInfo({ ...info, alreadyMember: already });
      }
    } catch (err) {
      setAddUserError(err.message);
    } finally {
      setAddVerifying(false);
    }
  };

  const handleConfirmAdd = async () => {
    if (!addUserInfo || !selectedGroup) return;
    setAddConfirming(true);
    setAddResult('');
    try {
      await addUserToGroup(addUserInfo.name, selectedGroup.name, selectedGroup.type, credential);
      setAddResult(`${addUserInfo.name} was added to ${selectedGroup.name}.`);
      resetAddPanel();
      loadMembers(selectedGroup);
    } catch (err) {
      setAddResult(`Error: ${err.message}`);
    } finally {
      setAddConfirming(false);
    }
  };

  // ── Remove user ────────────────────────────────────────────────────────────

  const handleInitRemove = (member) => {
    if (removePending?.name === member.name) {
      setRemovePending(null);
      setRemoveError('');
      return;
    }
    setRemovePending(member);
    setRemoveError('');
  };

  const handleConfirmRemove = async () => {
    if (!removePending || !selectedGroup) return;
    const identifier = removePending.samAccountName || removePending.name;
    setRemoveChecking(true);
    setRemoveError('');
    try {
      await removeUserFromGroup(identifier, selectedGroup.name, selectedGroup.type, credential);
      setRemovePending(null);
      loadMembers(selectedGroup);
    } catch (err) {
      setRemoveError(err.message);
    } finally {
      setRemoveChecking(false);
    }
  };

  // ── Helpers ────────────────────────────────────────────────────────────────

  const groupTypeLabel = (type) => (type === 'local' ? 'Local' : 'Domain');

  const memberDisplayName = (m) => {
    if (m.samAccountName && m.name && m.name.toLowerCase() !== m.samAccountName.toLowerCase()) {
      return `${m.samAccountName} — ${m.name}`;
    }
    return m.samAccountName || m.name;
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-5xl space-y-4">
      {/* Page header */}
      <div>
        <div className="flex items-center gap-3 mb-6">
          <UsersRound size={22} className="text-blue-600" />
          <h1 className="text-2xl font-bold">Manage Groups</h1>
        </div>
        <p className="text-sm text-gray-500 mt-1">
          Add or remove users from local and Active Directory groups.
          Configure groups in{' '}
          <a href="/config" className="text-blue-600 hover:underline">
            Settings
          </a>
          .
        </p>
      </div>

      {/* Privileged account panel */}
      <CredentialPanel
        open={credOpen}
        onToggle={() => setCredOpen((o) => !o)}
        username={adUsername}
        password={adPassword}
        showPassword={showPassword}
        onUsernameChange={setAdUsername}
        onPasswordChange={setAdPassword}
        onTogglePassword={() => setShowPassword((v) => !v)}
        onClear={() => { clearCreds(); setShowPassword(false); }}
      />

      {groups.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-8 text-center">
          <Users size={32} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500 font-medium">No managed groups configured.</p>
          <p className="text-sm text-gray-400 mt-1">
            Go to{' '}
            <a href="/config" className="text-blue-600 hover:underline">
              Settings
            </a>{' '}
            to add groups.
          </p>
        </div>
      ) : (
        <div className="flex gap-5 items-start">
          {/* ── Groups sidebar ── */}
          <div className="w-56 flex-shrink-0 flex flex-col bg-white rounded-lg shadow overflow-hidden"
            style={{ maxHeight: 'calc(100vh - 220px)' }}>
            {/* Header + filter */}
            <div className="px-3 pt-3 pb-2 border-b bg-gray-50 flex-shrink-0">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                Groups
              </p>
              <input
                className="input text-xs w-full py-1.5"
                placeholder="Filter..."
                value={groupFilter}
                onChange={(e) => setGroupFilter(e.target.value)}
              />
            </div>

            {/* Scrollable list */}
            <div className="overflow-y-auto flex-1 divide-y">
              {filteredGroups.length === 0 ? (
                <p className="px-4 py-3 text-xs text-gray-400 italic">No matches</p>
              ) : (
                filteredGroups.map((g, i) => (
                  <button
                    key={i}
                    onClick={() => selectGroup(g)}
                    className={`w-full text-left px-3 py-2.5 flex items-center gap-2 text-sm hover:bg-gray-50 transition-colors ${selectedGroup?.name === g.name && selectedGroup?.type === g.type
                        ? 'bg-blue-50 border-l-2 border-blue-500 font-medium text-blue-700'
                        : ''
                      }`}
                  >
                    <ShieldCheck size={14} className="flex-shrink-0 text-gray-400" />
                    <div className="flex-1 min-w-0">
                      <p className="truncate text-xs leading-tight">{g.name}</p>
                      <p className="text-xs text-gray-400">{groupTypeLabel(g.type)}</p>
                    </div>
                  </button>
                ))
              )}
            </div>

            {/* Count footer */}
            <div className="px-3 py-1.5 border-t bg-gray-50 flex-shrink-0">
              <p className="text-xs text-gray-400">
                {filteredGroups.length} of {groups.length}
              </p>
            </div>
          </div>

          {/* ── Main content ── */}
          <div className="flex-1 min-w-0 space-y-4">
            {!selectedGroup ? (
              <div className="bg-white rounded-lg shadow p-6 text-center text-gray-400 text-sm">
                <ChevronDown size={20} className="mx-auto mb-2" />
                Select a group to manage
              </div>
            ) : (
              <>
                {/* Group header */}
                <div className="bg-white rounded-lg shadow px-5 py-4 flex items-center gap-3">
                  <ShieldCheck size={20} className="text-blue-500 flex-shrink-0" />
                  <div className="flex-1">
                    <h2 className="font-semibold text-lg leading-tight">{selectedGroup.name}</h2>
                    <p className="text-xs text-gray-400">{groupTypeLabel(selectedGroup.type)} Group</p>
                  </div>
                  <button
                    onClick={() => loadMembers(selectedGroup)}
                    disabled={loadingMembers}
                    className="btn-secondary text-xs"
                    title="Refresh members"
                  >
                    <RefreshCw size={13} className={loadingMembers ? 'animate-spin' : ''} />
                    Refresh
                  </button>
                </div>

                {/* Add user panel */}
                <AddUserPanel
                  username={addUsername}
                  onUsernameChange={(v) => {
                    setAddUsername(v);
                    setAddUserInfo(null);
                    setAddUserError('');
                    setAddResult('');
                  }}
                  onVerify={handleVerifyUser}
                  verifying={addVerifying}
                  userInfo={addUserInfo}
                  userError={addUserError}
                  confirming={addConfirming}
                  onConfirmAdd={handleConfirmAdd}
                  onCancel={resetAddPanel}
                  result={addResult}
                  groupType={selectedGroup.type}
                />

                {/* Members list */}
                <div className="bg-white rounded-lg shadow overflow-hidden">
                  <div className="px-5 py-3 border-b bg-gray-50 flex items-center justify-between">
                    <p className="text-sm font-medium text-gray-700">
                      Current Members
                      {members.length > 0 && (
                        <span className="ml-2 text-xs font-normal text-gray-400">
                          ({members.length})
                        </span>
                      )}
                    </p>
                  </div>

                  {loadingMembers ? (
                    <div className="px-5 py-6 flex items-center gap-2 text-sm text-gray-400">
                      <Loader size={15} className="animate-spin" /> Loading members...
                    </div>
                  ) : membersError ? (
                    <div className="px-5 py-4 flex items-start gap-2 text-sm text-red-600">
                      <AlertCircle size={15} className="flex-shrink-0 mt-0.5" />
                      {membersError}
                    </div>
                  ) : members.length === 0 ? (
                    <p className="px-5 py-4 text-sm text-gray-400 italic">No members found.</p>
                  ) : (
                    <div className="divide-y">
                      {members.map((m, i) => (
                        <MemberRow
                          key={i}
                          member={m}
                          displayName={memberDisplayName(m)}
                          isPending={removePending?.name === m.name}
                          onRemoveClick={() => handleInitRemove(m)}
                          onConfirmRemove={handleConfirmRemove}
                          removeChecking={removeChecking}
                          removeError={removePending?.name === m.name ? removeError : ''}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Credential panel ──────────────────────────────────────────────────────────

function CredentialPanel({
  open, onToggle,
  username, password, showPassword,
  onUsernameChange, onPasswordChange, onTogglePassword, onClear,
}) {
  const hasCredential = !!username.trim();

  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      {/* Collapsed header — always visible */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-5 py-3 hover:bg-gray-50 transition-colors text-left"
      >
        <KeyRound size={16} className={hasCredential ? 'text-blue-500' : 'text-gray-400'} />
        <div className="flex-1">
          <span className="text-sm font-medium">
            Privileged Account
          </span>
          <span className="ml-3 text-xs text-gray-400">
            {hasCredential
              ? `Running as: ${username.trim()}`
              : 'Optional — leave blank to use the current account'}
          </span>
        </div>
        {hasCredential && (
          <span className="text-xs bg-blue-100 text-blue-700 font-medium px-2 py-0.5 rounded-full mr-2">
            Active
          </span>
        )}
        <ChevronDown
          size={15}
          className={`text-gray-400 transition-transform flex-shrink-0 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {/* Expanded body */}
      {open && (
        <div className="px-5 pb-4 border-t pt-4 space-y-3">
          <p className="text-xs text-gray-500">
            AD operations will run under this account. Required for privileged AD changes
            when the current session does not have sufficient rights. Leave blank to use
            the account running this application.
          </p>
          <div className="flex gap-3">
            <label className="block flex-1">
              <span className="text-xs font-medium text-gray-600">Username</span>
              <input
                className="input mt-1 text-sm"
                placeholder="DOMAIN\username or UPN"
                value={username}
                onChange={(e) => onUsernameChange(e.target.value)}
                autoComplete="username"
              />
            </label>
            <label className="block flex-1">
              <span className="text-xs font-medium text-gray-600">Password</span>
              <div className="relative mt-1">
                <input
                  className="input w-full text-sm pr-9"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Password"
                  value={password}
                  onChange={(e) => onPasswordChange(e.target.value)}
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={onTogglePassword}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </label>
          </div>
          {hasCredential && (
            <button
              type="button"
              onClick={onClear}
              className="flex items-center gap-1 text-xs text-gray-400 hover:text-red-500 transition-colors"
            >
              <X size={13} /> Clear credentials
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Add user panel ────────────────────────────────────────────────────────────

function AddUserPanel({
  username, onUsernameChange, onVerify, verifying,
  userInfo, userError, confirming, onConfirmAdd, onCancel, result, groupType,
}) {
  return (
    <div className="bg-white rounded-lg shadow p-5">
      <h3 className="font-medium text-sm mb-3 flex items-center gap-2 text-gray-700">
        <UserPlus size={15} /> Add User to Group
      </h3>

      <div className="flex gap-2 mb-3">
        <input
          className="input flex-1 text-sm"
          placeholder={
            groupType === 'local'
              ? 'Username (e.g. john)'
              : 'SAM account name (e.g. jsmith)'
          }
          value={username}
          onChange={(e) => onUsernameChange(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !verifying && onVerify()}
        />
        <button
          onClick={onVerify}
          disabled={verifying || !username.trim()}
          className="btn-secondary text-sm flex-shrink-0"
        >
          {verifying ? (
            <>
              <Loader size={13} className="animate-spin" /> Verifying...
            </>
          ) : (
            'Verify User'
          )}
        </button>
      </div>

      {userError && (
        <div className="flex items-start gap-2 text-sm text-red-600 mb-3">
          <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
          {userError}
        </div>
      )}

      {userInfo && (
        <div className="rounded border p-3 mb-3 bg-green-50 border-green-200">
          <div className="flex items-start gap-2">
            <CheckCircle size={15} className="text-green-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-medium text-green-800 text-sm">{userInfo.name}</p>
              {userInfo.displayName && userInfo.displayName !== userInfo.name && (
                <p className="text-xs text-green-700">{userInfo.displayName}</p>
              )}
              {userInfo.fullName && userInfo.fullName !== userInfo.name && (
                <p className="text-xs text-green-700">{userInfo.fullName}</p>
              )}
              {userInfo.email && (
                <p className="text-xs text-gray-500">{userInfo.email}</p>
              )}
              <div className="flex items-center gap-3 mt-1">
                <span
                  className={`text-xs font-medium ${userInfo.enabled ? 'text-green-600' : 'text-red-500'
                    }`}
                >
                  {userInfo.enabled ? 'Enabled' : 'Disabled'}
                </span>
                {userInfo.alreadyMember && (
                  <span className="text-xs text-amber-600 font-medium">
                    Already a member
                  </span>
                )}
              </div>
            </div>
          </div>

          {userInfo.alreadyMember ? (
            <p className="text-xs text-amber-600 mt-2 ml-5">
              This user is already in the group.
            </p>
          ) : (
            <div className="flex gap-2 mt-3 ml-5">
              <button
                onClick={onConfirmAdd}
                disabled={confirming}
                className="btn-primary text-xs"
              >
                {confirming ? (
                  <>
                    <Loader size={12} className="animate-spin" /> Adding...
                  </>
                ) : (
                  <>
                    <UserPlus size={12} /> Confirm — Add to Group
                  </>
                )}
              </button>
              <button onClick={onCancel} className="btn-secondary text-xs">
                Cancel
              </button>
            </div>
          )}
        </div>
      )}

      {result && (
        <p
          className={`text-xs mt-1 ${result.startsWith('Error') ? 'text-red-600' : 'text-green-600'
            }`}
        >
          {result}
        </p>
      )}
    </div>
  );
}

// ── Member row ────────────────────────────────────────────────────────────────

function MemberRow({
  member, displayName, isPending,
  onRemoveClick, onConfirmRemove, removeChecking, removeError,
}) {
  const typeLabel =
    member.type === 'user' || member.type === 'inetOrgPerson'
      ? 'User'
      : member.type === 'computer'
        ? 'Computer'
        : member.type === 'group'
          ? 'Group'
          : member.type || '';

  return (
    <div className={`transition-colors ${isPending ? 'bg-red-50' : 'hover:bg-gray-50'}`}>
      <div className="px-5 py-3 flex items-center gap-3">
        <Users size={14} className="text-gray-400 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-medium truncate">{displayName}</p>
            {member.enabled === false && (
              <span className="text-xs font-medium bg-red-100 text-red-600 px-1.5 py-0.5 rounded flex-shrink-0">
                Disabled
              </span>
            )}
          </div>
          {typeLabel && <p className="text-xs text-gray-400">{typeLabel}</p>}
        </div>
        <button
          onClick={onRemoveClick}
          className={`flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded transition-colors ${isPending
              ? 'bg-red-100 text-red-700 hover:bg-red-200'
              : 'text-gray-400 hover:text-red-600 hover:bg-red-50'
            }`}
        >
          <UserMinus size={13} />
          {isPending ? 'Cancel' : 'Remove'}
        </button>
      </div>

      {isPending && (
        <div className="px-5 pb-3">
          <div className="bg-white border border-red-200 rounded p-3">
            <p className="text-sm text-red-700 mb-2">
              Remove <strong>{displayName}</strong> from this group?
            </p>
            {removeError && (
              <p className="text-xs text-red-600 mb-2 flex items-center gap-1">
                <AlertCircle size={12} /> {removeError}
              </p>
            )}
            <div className="flex gap-2">
              <button
                onClick={onConfirmRemove}
                disabled={removeChecking}
                className="bg-red-600 hover:bg-red-700 text-white text-xs font-medium px-3 py-1.5 rounded flex items-center gap-1 transition-colors"
              >
                {removeChecking ? (
                  <>
                    <Loader size={12} className="animate-spin" /> Removing...
                  </>
                ) : (
                  <>
                    <UserMinus size={12} /> Confirm Remove
                  </>
                )}
              </button>
              <button onClick={onRemoveClick} className="btn-secondary text-xs">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
