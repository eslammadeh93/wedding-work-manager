import React, { useState } from 'react';
import {
  Users,
  UserPlus,
  Search,
  ShieldCheck,
  Shield,
  User,
  KeyRound,
  CheckCircle2,
  XCircle,
  Edit2,
  Trash2,
  Phone,
  Mail,
  Lock,
  Sparkles,
  RefreshCw,
  X,
  Crown,
} from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { useAuth } from '../../context/AuthContext';
import { UserProfile, UserRole } from '../../types';
import { sanitizePhoneInput } from '../../utils/phone';

export const UsersModule: React.FC = () => {
  const { t } = useLanguage();
  const {
    profile,
    allUsers,
    createUserAccount,
    updateUserProfile,
    toggleUserStatus,
    resetUserPassword,
    deleteUserAccount,
  } = useAuth();

  // Search & Filter state
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedRole, setSelectedRole] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');

  // Modals state
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserProfile | null>(null);
  const [resetSentEmail, setResetSentEmail] = useState<string | null>(null);

  // Add User Form State
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newRole, setNewRole] = useState<UserRole>('employee');
  const [newPassword, setNewPassword] = useState('Wedding@2026');
  const [newIsActive, setNewIsActive] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Edit Form State
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editRole, setEditRole] = useState<UserRole>('employee');
  const [editIsActive, setEditIsActive] = useState(true);

  // Restrict access if not Admin or Super Admin
  if (profile?.role !== 'admin' && profile?.role !== 'super_admin') {
    return (
      <div className="p-12 text-center bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm animate-in fade-in">
        <ShieldCheck className="w-16 h-16 mx-auto text-rose-500 mb-4 opacity-80" />
        <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">
          {t('accessDenied')}
        </h3>
        <p className="text-sm text-slate-500 max-w-md mx-auto">{t('accessDeniedDesc')}</p>
      </div>
    );
  }

  // Filtered list
  const filteredUsers = allUsers.filter((u) => {
    const matchesSearch =
      !searchTerm.trim() ||
      u.displayName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      u.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (u.phone && u.phone.includes(searchTerm));

    if (!matchesSearch) return false;
    if (selectedRole !== 'all' && u.role !== selectedRole) return false;
    if (selectedStatus === 'active' && !u.isActive) return false;
    if (selectedStatus === 'inactive' && u.isActive) return false;

    return true;
  });

  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName || !newEmail) return;

    setIsSubmitting(true);
    try {
      await createUserAccount({
        displayName: newName,
        email: newEmail,
        phone: newPhone,
        role: newRole,
        password: newPassword,
        isActive: newIsActive,
      });

      // Reset form
      setNewName('');
      setNewEmail('');
      setNewPhone('');
      setNewRole('employee');
      setNewPassword('Wedding@2026');
      setIsAddOpen(false);
    } catch (err) {
      console.error('Error creating user:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const openEditModal = (u: UserProfile) => {
    setEditingUser(u);
    setEditName(u.displayName);
    setEditPhone(sanitizePhoneInput(u.phone || ''));
    setEditRole(u.role);
    setEditIsActive(u.isActive);
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;

    setIsSubmitting(true);
    try {
      await updateUserProfile(editingUser.uid, {
        displayName: editName,
        phone: editPhone,
        role: editRole,
        isActive: editIsActive,
      });
      setEditingUser(null);
    } catch (err) {
      console.error('Error updating user:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResetPassword = async (email: string) => {
    await resetUserPassword(email);
    setResetSentEmail(email);
    setTimeout(() => setResetSentEmail(null), 4000);
  };

  const getRoleBadge = (role: UserRole) => {
    switch (role) {
      case 'super_admin':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-gradient-to-r from-amber-500 to-amber-400 text-slate-950 font-black text-[10px] uppercase rounded-lg shadow-xs">
            <Crown className="w-3 h-3 text-slate-950 fill-slate-950" />
            {t('roleSuperAdmin')}
          </span>
        );
      case 'admin':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 font-extrabold text-[10px] uppercase rounded-lg border border-amber-300/40">
            <Crown className="w-3 h-3 text-amber-600" />
            {t('roleAdmin')}
          </span>
        );
      case 'manager':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300 font-bold text-[10px] uppercase rounded-lg border border-blue-300/40">
            <Shield className="w-3 h-3 text-blue-600" />
            {t('roleManager')}
          </span>
        );
      case 'employee':
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 font-bold text-[10px] uppercase rounded-lg border border-slate-300/40 dark:border-slate-700">
            <User className="w-3 h-3 text-slate-500" />
            {t('roleEmployee')}
          </span>
        );
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Users className="w-6 h-6 text-amber-500" />
            <span>{t('userManagement')}</span>
          </h2>
        </div>

        <button
          onClick={() => setIsAddOpen(true)}
          className="px-5 py-2.5 bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs sm:text-sm rounded-xl shadow-md shadow-amber-500/20 transition-all cursor-pointer flex items-center gap-2"
        >
          <UserPlus className="w-4 h-4" />
          <span>{t('addUser')}</span>
        </button>
      </div>

      {/* Password reset toast notification */}
      {resetSentEmail && (
        <div className="p-3 bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 rounded-xl text-xs font-bold flex items-center gap-2 animate-in slide-in-from-top duration-300">
          <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          <span>
            {t('passwordResetSent')} ({resetSentEmail})
          </span>
        </div>
      )}

      {/* KPI Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <div className="p-4 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
          <span className="text-[11px] font-bold text-slate-500 uppercase block">Total Users</span>
          <p className="text-xl font-black text-slate-900 dark:text-white mt-1">
            {allUsers.length}
          </p>
        </div>

        <div className="p-4 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
          <span className="text-[11px] font-bold text-amber-600 dark:text-amber-400 uppercase block">
            Admins
          </span>
          <p className="text-xl font-black text-slate-900 dark:text-white mt-1">
            {allUsers.filter((u) => u.role === 'admin').length}
          </p>
        </div>

        <div className="p-4 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
          <span className="text-[11px] font-bold text-blue-600 dark:text-blue-400 uppercase block">
            Managers
          </span>
          <p className="text-xl font-black text-slate-900 dark:text-white mt-1">
            {allUsers.filter((u) => u.role === 'manager').length}
          </p>
        </div>

        <div className="p-4 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
          <span className="text-[11px] font-bold text-slate-500 uppercase block">
            Employees
          </span>
          <p className="text-xl font-black text-slate-900 dark:text-white mt-1">
            {allUsers.filter((u) => u.role === 'employee').length}
          </p>
        </div>

        <div className="p-4 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs col-span-2 lg:col-span-1">
          <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 uppercase block">
            Active / Disabled
          </span>
          <p className="text-xl font-black text-slate-900 dark:text-white mt-1">
            {allUsers.filter((u) => u.isActive).length} /{' '}
            <span className="text-rose-500">{allUsers.filter((u) => !u.isActive).length}</span>
          </p>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="p-4 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute ltr:left-3 rtl:right-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search users by name, email, phone..."
            className="w-full ltr:pl-9 rtl:pr-9 ltr:pr-4 rtl:pl-4 py-2 bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-amber-500"
          />
        </div>

        <select
          value={selectedRole}
          onChange={(e) => setSelectedRole(e.target.value)}
          className="px-3 py-2 bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-amber-500 cursor-pointer"
        >
          <option value="all">All Roles</option>
          <option value="super_admin">{t('roleSuperAdmin')}</option>
          <option value="admin">{t('roleAdmin')}</option>
          <option value="manager">{t('roleManager')}</option>
          <option value="employee">{t('roleEmployee')}</option>
        </select>

        <select
          value={selectedStatus}
          onChange={(e) => setSelectedStatus(e.target.value)}
          className="px-3 py-2 bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-amber-500 cursor-pointer"
        >
          <option value="all">All Statuses</option>
          <option value="active">{t('active')}</option>
          <option value="inactive">{t('inactive')}</option>
        </select>
      </div>

      {/* Users Table */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left rtl:text-right text-xs">
            <thead className="bg-slate-50 dark:bg-slate-800/80 text-slate-500 dark:text-slate-400 font-bold uppercase tracking-wider border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="p-4">{t('fullName')} & {t('email')}</th>
                <th className="p-4">{t('phone')}</th>
                <th className="p-4">{t('role')}</th>
                <th className="p-4 text-center">{t('status')}</th>
                <th className="p-4">Created Date</th>
                <th className="p-4">Last Login</th>
                <th className="p-4 text-right rtl:text-left">{t('actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-800 dark:text-slate-200">
              {filteredUsers.map((u) => (
                <tr
                  key={u.uid}
                  className="hover:bg-slate-50/50 dark:hover:bg-slate-800/50 transition-colors"
                >
                  <td className="p-4 font-bold">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-amber-500 to-amber-400 text-slate-950 font-black text-xs flex items-center justify-center shrink-0">
                        {u.displayName.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div className="text-slate-900 dark:text-white text-sm font-extrabold">
                          {u.displayName}
                        </div>
                        <div className="text-slate-400 font-normal text-xs flex items-center gap-1 mt-0.5">
                          <Mail className="w-3 h-3" />
                          <span>{u.email}</span>
                        </div>
                      </div>
                    </div>
                  </td>

                  <td className="p-4 font-medium text-slate-600 dark:text-slate-300">
                    <div className="flex items-center gap-1">
                      <Phone className="w-3.5 h-3.5 text-amber-500" />
                      <span>{u.phone || 'N/A'}</span>
                    </div>
                  </td>

                  <td className="p-4">{getRoleBadge(u.role)}</td>

                  <td className="p-4 text-center">
                    {u.isActive ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 font-bold text-[10px] rounded-full border border-emerald-200 dark:border-emerald-800">
                        <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                        {t('active')}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-400 font-bold text-[10px] rounded-full border border-rose-200 dark:border-rose-800">
                        <XCircle className="w-3 h-3 text-rose-500" />
                        {t('inactive')}
                      </span>
                    )}
                  </td>

                  <td className="p-4 text-slate-500 font-medium whitespace-nowrap">
                    {u.createdAt ? new Date(u.createdAt).toLocaleDateString() : 'N/A'}
                  </td>

                  <td className="p-4 text-slate-500 font-medium whitespace-nowrap">
                    {u.lastLogin && u.lastLogin !== 'Never' && !isNaN(Date.parse(u.lastLogin))
                      ? new Date(u.lastLogin).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
                      : u.lastLogin || 'Never'}
                  </td>

                  <td className="p-4 text-right rtl:text-left">
                    <div className="flex items-center justify-end gap-1.5">
                      {/* Password Reset */}
                      <button
                        onClick={() => handleResetPassword(u.email)}
                        className="p-1.5 text-slate-500 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/30 rounded-lg transition-colors cursor-pointer"
                        title={t('resetPassword')}
                      >
                        <KeyRound className="w-4 h-4" />
                      </button>

                      {/* Enable/Disable status toggle */}
                      <button
                        onClick={() => toggleUserStatus(u.uid, !u.isActive)}
                        className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                          u.isActive
                            ? 'text-emerald-600 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30'
                            : 'text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/30'
                        }`}
                        title={u.isActive ? t('disableAccount') : t('enableAccount')}
                      >
                        {u.isActive ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                      </button>

                      {/* Edit Profile */}
                      <button
                        onClick={() => openEditModal(u)}
                        className="p-1.5 text-slate-500 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/30 rounded-lg transition-colors cursor-pointer"
                        title={t('editUser')}
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>

                      {/* Delete user */}
                      {u.uid !== profile?.uid && (
                        <button
                          onClick={async () => {
                            if (window.confirm(`Delete user ${u.displayName}?`)) {
                              await deleteUserAccount(u.uid);
                            }
                          }}
                          className="p-1.5 text-rose-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded-lg transition-colors cursor-pointer"
                          title={t('delete')}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* CREATE USER MODAL */}
      {isAddOpen && (
        <div onClick={() => setIsAddOpen(false)} className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div onClick={(e) => e.stopPropagation()} className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-lg w-full p-6 space-y-5 animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <UserPlus className="w-5 h-5 text-amber-500" />
                <span>{t('addUser')}</span>
              </h3>
              <button
                onClick={() => setIsAddOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-white rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleAddSubmit} className="space-y-4 text-xs">
              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  {t('fullName')} *
                </label>
                <input
                  type="text"
                  required
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. Faisal Al-Otaibi"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white font-medium outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  {t('email')} *
                </label>
                <input
                  type="email"
                  required
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="e.g. employee@weddingmanager.com"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white font-medium outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                    {t('phone')}
                  </label>
                  <input
                    type="text"
                    value={newPhone}
                    onChange={(e) => setNewPhone(sanitizePhoneInput(e.target.value))}
                    dir="ltr"
                    inputMode="tel"
                    placeholder="+966 50 111 2233"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white font-medium outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                    {t('role')}
                  </label>
                  <select
                    value={newRole}
                    onChange={(e) => setNewRole(e.target.value as UserRole)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white font-bold outline-none focus:ring-2 focus:ring-amber-500 cursor-pointer"
                  >
                    <option value="super_admin">{t('roleSuperAdmin')}</option>
                    <option value="admin">{t('roleAdmin')}</option>
                    <option value="manager">{t('roleManager')}</option>
                    <option value="employee">{t('roleEmployee')}</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Initial Password
                </label>
                <input
                  type="text"
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white font-mono font-medium outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="newIsActive"
                  checked={newIsActive}
                  onChange={(e) => setNewIsActive(e.target.checked)}
                  className="w-4 h-4 rounded text-amber-500 focus:ring-amber-500 cursor-pointer"
                />
                <label
                  htmlFor="newIsActive"
                  className="text-xs font-bold text-slate-700 dark:text-slate-300 cursor-pointer"
                >
                  Active Account Immediately
                </label>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsAddOpen(false)}
                  className="px-4 py-2 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 font-bold"
                >
                  {t('cancel')}
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-xl font-bold shadow-md shadow-amber-500/20"
                >
                  {isSubmitting ? 'Creating...' : t('save')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* EDIT USER MODAL */}
      {editingUser && (
        <div onClick={() => setEditingUser(null)} className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div onClick={(e) => e.stopPropagation()} className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-lg w-full p-6 space-y-5 animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Edit2 className="w-5 h-5 text-amber-500" />
                <span>{t('editUser')}</span>
              </h3>
              <button
                onClick={() => setEditingUser(null)}
                className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-white rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleEditSubmit} className="space-y-4 text-xs">
              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  {t('fullName')}
                </label>
                <input
                  type="text"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white font-medium outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                    {t('phone')}
                  </label>
                  <input
                    type="text"
                    value={editPhone}
                    onChange={(e) => setEditPhone(sanitizePhoneInput(e.target.value))}
                    dir="ltr"
                    inputMode="tel"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white font-medium outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                    {t('role')}
                  </label>
                  <select
                    value={editRole}
                    onChange={(e) => setEditRole(e.target.value as UserRole)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white font-bold outline-none focus:ring-2 focus:ring-amber-500 cursor-pointer"
                  >
                    <option value="super_admin">{t('roleSuperAdmin')}</option>
                    <option value="admin">{t('roleAdmin')}</option>
                    <option value="manager">{t('roleManager')}</option>
                    <option value="employee">{t('roleEmployee')}</option>
                  </select>
                </div>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="editIsActive"
                  checked={editIsActive}
                  onChange={(e) => setEditIsActive(e.target.checked)}
                  className="w-4 h-4 rounded text-amber-500 focus:ring-amber-500 cursor-pointer"
                />
                <label
                  htmlFor="editIsActive"
                  className="text-xs font-bold text-slate-700 dark:text-slate-300 cursor-pointer"
                >
                  Active Account Status
                </label>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setEditingUser(null)}
                  className="px-4 py-2 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 font-bold"
                >
                  {t('cancel')}
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-xl font-bold shadow-md shadow-amber-500/20"
                >
                  {isSubmitting ? 'Saving...' : t('save')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
