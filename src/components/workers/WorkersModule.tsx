import React, { useState, useMemo } from 'react';
import {
  Users,
  UserPlus,
  Search,
  Filter,
  Edit,
  Trash2,
  CheckCircle2,
  XCircle,
  Phone,
  Briefcase,
  Key,
  UserCheck,
  FileText,
  X,
  User,
  Eye,
  EyeOff,
} from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { useData } from '../../context/DataContext';
import { useAuth } from '../../context/AuthContext';
import { Worker } from '../../types';
import { companyMembersService } from '../../multiTenant/companyMembersService';
import { sanitizePhoneInput } from '../../utils/phone';

export const WorkersModule: React.FC = () => {
  const { t } = useLanguage();
  const { workers, addWorker, updateWorker, deleteWorker, toggleWorkerStatus } = useData();
  const { isDemo } = useAuth();

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  
  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingWorker, setEditingWorker] = useState<Worker | null>(null);

  // Form State
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [loginCode, setLoginCode] = useState('');
  const [showLoginCode, setShowLoginCode] = useState(false);
  const [jobTitle, setJobTitle] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState<'active' | 'inactive'>('active');
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const filteredWorkers = useMemo(() => {
    return workers.filter((worker) => {
      const matchesSearch =
        worker.fullName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        worker.username.toLowerCase().includes(searchTerm.toLowerCase()) ||
        worker.phone.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (worker.jobTitle && worker.jobTitle.toLowerCase().includes(searchTerm.toLowerCase()));

      const matchesStatus =
        statusFilter === 'all' ? true : worker.status === statusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [workers, searchTerm, statusFilter]);

  const handleOpenAddModal = () => {
    setEditingWorker(null);
    setFullName('');
    setUsername('');
    setLoginCode('');
    setShowLoginCode(false);
    setJobTitle('');
    setPhone('');
    setNotes('');
    setStatus('active');
    setFormError(null);
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (worker: Worker) => {
    setEditingWorker(worker);
    setFullName(worker.fullName);
    setUsername(worker.username);
    setLoginCode('');
    setShowLoginCode(false);
    setJobTitle(worker.jobTitle || '');
    setPhone(sanitizePhoneInput(worker.phone || ''));
    setNotes(worker.notes || '');
    setStatus(worker.status);
    setFormError(null);
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;
    setFormError(null);

    const cleanUsername = username.trim().toLowerCase();
    const cleanCode = loginCode.trim();

    if (!fullName.trim() || !cleanUsername || (!editingWorker && !cleanCode)) {
      setFormError('يرجى ملء جميع الحقول المطلوبة (الاسم الكامل، اسم المستخدم، وكود الدخول)');
      return;
    }

    // Unique Username validation
    const usernameExists = workers.some(
      (w) => w.username.toLowerCase() === cleanUsername && w.id !== editingWorker?.id
    );

    if (usernameExists) {
      setFormError('اسم المستخدم مستخدم بالفعل، يرجى كتابة اسم مستخدم آخر');
      return;
    }

    setIsSaving(true);
    try {
      if (editingWorker) {
        if (isDemo) {
          await updateWorker(editingWorker.id, { fullName: fullName.trim(), username: cleanUsername, jobTitle: jobTitle.trim(), phone: phone.trim(), notes: notes.trim(), status, ...(cleanCode ? { loginCode: cleanCode } : {}) });
        } else {
          const updated = await companyMembersService.updateWorker({
            workerId: editingWorker.id,
            name: fullName.trim(),
            username: cleanUsername,
            jobTitle: jobTitle.trim(),
            phone: phone.trim(),
            notes: notes.trim(),
          });
          if (!updated.success) throw new Error(updated.message);
          if (editingWorker.status !== status) { const changed = await companyMembersService.setWorkerStatus({ workerId: editingWorker.id, status }); if (!changed.success) throw new Error(changed.message); }
          if (cleanCode) {
            const reset = await companyMembersService.resetWorkerLoginCode({ workerId: editingWorker.id, loginCode: cleanCode });
            if (!reset.success) throw new Error(reset.message);
          }
        }
      } else {
        if (isDemo) await addWorker({ fullName: fullName.trim(), username: cleanUsername, loginCode: cleanCode, jobTitle: jobTitle.trim(), phone: phone.trim(), notes: notes.trim(), status });
        else {
          const result = await companyMembersService.create({ name: fullName.trim(), username: cleanUsername, loginCode: cleanCode, jobTitle: jobTitle.trim(), phone: phone.trim(), notes: notes.trim(), role: 'worker' });
          if (!result.success) throw new Error(result.message);
        }
      }

      setIsModalOpen(false);
    } catch (err: any) {
      setFormError(err.message || 'حدث خطأ أثناء حفظ بيانات العامل');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (window.confirm(`هل أنت تأكد من رغبتك في حذف العامل "${name}"؟`)) {
      try {
        if (isDemo) await deleteWorker(id);
        else {
          const result = await companyMembersService.deleteWorker({ workerId: id });
          if (!result.success) throw new Error(result.message);
        }
      } catch (error) {
        alert(error instanceof Error ? error.message : 'تعذر حذف العامل بالكامل.');
      }
    }
  };

  const handleToggleStatus = async (worker: Worker) => {
    try {
      const newStatus = worker.status === 'active' ? 'inactive' : 'active';
      if (isDemo) await toggleWorkerStatus(worker.id, newStatus);
      else {
        const result = await companyMembersService.setWorkerStatus({ workerId: worker.id, status: newStatus });
        if (!result.success) throw new Error(result.message);
      }
    } catch (error) { alert(error instanceof Error ? error.message : 'تعذر تحديث حالة العامل.'); }
  };

  return (
    <div className="space-y-6">
      {/* Top Header & Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-slate-900 p-5 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xs">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-amber-500/10 dark:bg-amber-500/20 text-amber-600 dark:text-amber-400 rounded-2xl flex items-center justify-center font-bold">
            <Users className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-extrabold text-slate-900 dark:text-white">
              {t('workers')}
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              إدارة بيانات حسابات العمال والمنفذين وتوزيع الطلبات عليهم
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          <button
            onClick={handleOpenAddModal}
            className="px-4 py-2.5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-slate-950 font-black text-xs rounded-xl shadow-md shadow-amber-500/20 flex items-center justify-center gap-2 cursor-pointer transition-all"
          >
            <UserPlus className="w-4 h-4" />
            <span>{t('addWorker')}</span>
          </button>
        </div>
      </div>

      {/* Controls Bar (Search & Filters) */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute ltr:left-3.5 rtl:right-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder={t('searchWorker')}
            className="w-full ltr:pl-10 rtl:pr-10 ltr:pr-4 rtl:pl-4 py-2.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/80 rounded-xl text-xs font-semibold text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500"
          />
        </div>

        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-slate-400 shrink-0" />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="px-3 py-2.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/80 rounded-xl text-xs font-bold text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-amber-500 cursor-pointer"
          >
            <option value="all">{t('all')}</option>
            <option value="active">{t('active')}</option>
            <option value="inactive">{t('inactive')}</option>
          </select>
        </div>
      </div>

      {/* Workers Cards / Table List */}
      {filteredWorkers.length === 0 ? (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-12 text-center">
          <Users className="w-12 h-12 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
          <h3 className="text-base font-bold text-slate-700 dark:text-slate-300">
            {t('noData')}
          </h3>
          <p className="text-xs text-slate-400 mt-1">
            لم يتم العثور على أية عمال مطابقة لمعايير البحث.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredWorkers.map((worker) => (
            <div
              key={worker.id}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 shadow-2xs hover:border-amber-500/50 transition-all flex flex-col justify-between"
            >
              <div>
                {/* Header info & status badge */}
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-2xl bg-slate-100 dark:bg-slate-800 text-amber-500 font-extrabold text-sm flex items-center justify-center shrink-0">
                      <User className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="font-extrabold text-sm text-slate-900 dark:text-white leading-tight">
                        {worker.fullName}
                      </h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1 mt-0.5">
                        <Briefcase className="w-3 h-3 text-slate-400" />
                        <span>{worker.jobTitle || 'عامل'}</span>
                      </p>
                    </div>
                  </div>

                  <button
                    onClick={() => handleToggleStatus(worker)}
                    className={`px-2.5 py-1 rounded-full text-[10px] font-bold flex items-center gap-1 cursor-pointer transition-colors ${
                      worker.status === 'active'
                        ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20'
                        : 'bg-rose-500/10 text-rose-600 dark:text-rose-400 hover:bg-rose-500/20'
                    }`}
                  >
                    {worker.status === 'active' ? (
                      <>
                        <CheckCircle2 className="w-3 h-3" />
                        <span>{t('active')}</span>
                      </>
                    ) : (
                      <>
                        <XCircle className="w-3 h-3" />
                        <span>{t('inactive')}</span>
                      </>
                    )}
                  </button>
                </div>

                {/* Details list */}
                <div className="space-y-2 py-3 border-t border-b border-slate-100 dark:border-slate-800/80 my-3 text-xs">
                  <div className="flex items-center justify-between text-slate-600 dark:text-slate-300">
                    <span className="text-slate-400 flex items-center gap-1">
                      <UserCheck className="w-3.5 h-3.5" />
                      <span>{t('username')}:</span>
                    </span>
                    <span className="font-mono font-bold dir-ltr">{worker.username}</span>
                  </div>

                  <div className="flex items-center justify-between text-slate-600 dark:text-slate-300">
                    <span className="text-slate-400 flex items-center gap-1">
                      <Key className="w-3.5 h-3.5" />
                      <span>{t('loginCode')}:</span>
                    </span>
                    <span className="font-mono font-bold bg-amber-500/10 text-amber-600 dark:text-amber-400 px-2 py-0.5 rounded-md dir-ltr">
                      محفوظ بأمان
                    </span>
                  </div>

                  {worker.phone && (
                    <div className="flex items-center justify-between text-slate-600 dark:text-slate-300">
                      <span className="text-slate-400 flex items-center gap-1">
                        <Phone className="w-3.5 h-3.5" />
                        <span>الهاتف:</span>
                      </span>
                      <span className="font-semibold dir-ltr">{worker.phone}</span>
                    </div>
                  )}

                  {worker.notes && (
                    <div className="text-slate-500 dark:text-slate-400 text-[11px] pt-1">
                      <span className="font-semibold text-slate-400 block mb-0.5">ملاحظات:</span>
                      <p className="line-clamp-2 italic">{worker.notes}</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Actions Footer */}
              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  onClick={() => handleOpenEditModal(worker)}
                  className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-bold rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer"
                >
                  <Edit className="w-3.5 h-3.5" />
                  <span>{t('edit')}</span>
                </button>

                <button
                  onClick={() => handleDelete(worker.id, worker.fullName)}
                  className="px-3 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 text-xs font-bold rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>{t('delete')}</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Worker Form Modal */}
      {isModalOpen && (
        <div onClick={() => setIsModalOpen(false)} className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div onClick={(e) => e.stopPropagation()} className="bg-white dark:bg-slate-900 w-full max-w-md rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden animate-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="p-5 bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 flex items-center justify-between">
              <h3 className="font-extrabold text-base flex items-center gap-2">
                <UserPlus className="w-5 h-5" />
                <span>{editingWorker ? t('editWorker') : t('addWorker')}</span>
              </h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="p-1 bg-black/10 hover:bg-black/20 text-slate-950 rounded-xl transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Form */}
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              {formError && (
                <div className="p-3 bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400 rounded-2xl text-xs font-bold">
                  {formError}
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                  الاسم الكامل <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="مثال: أحمد محمد علي"
                  className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                    اسم المستخدم <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required={!editingWorker}
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="ahmed123"
                    className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-900 dark:text-white dir-ltr text-right focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                    كود الدخول {!editingWorker && <span className="text-rose-500">*</span>}
                  </label>
                  <div className="relative">
                    <input
                      type={showLoginCode ? 'text' : 'password'}
                      required={!editingWorker}
                      value={loginCode}
                      onChange={(e) => setLoginCode(e.target.value)}
                      placeholder={editingWorker ? 'الكود الحالي محفوظ — اكتب هنا لتغييره' : '6 أرقام على الأقل'}
                      className="w-full ltr:pr-10 rtl:pl-10 ltr:pl-3.5 rtl:pr-3.5 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-900 dark:text-white dir-ltr text-right focus:outline-none focus:ring-2 focus:ring-amber-500"
                    />
                    <button
                      type="button"
                      onClick={() => setShowLoginCode((visible) => !visible)}
                      className="absolute inset-y-0 ltr:right-0 rtl:left-0 flex w-10 items-center justify-center text-slate-400 hover:text-amber-600 dark:hover:text-amber-400"
                      aria-label={showLoginCode ? 'إخفاء كود الدخول' : 'إظهار كود الدخول'}
                      title={showLoginCode ? 'إخفاء كود الدخول' : 'إظهار كود الدخول'}
                    >
                      {showLoginCode ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  {editingWorker && (
                    <p className="mt-1 text-[10px] text-slate-500 dark:text-slate-400">
                      اترك الحقل كما هو وسيبقى كود الدخول الحالي دون تغيير.
                    </p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                    المسمى الوظيفي
                  </label>
                  <input
                    type="text"
                    value={jobTitle}
                    onChange={(e) => setJobTitle(e.target.value)}
                    placeholder="فني تركيبات / منفذ"
                    className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                    رقم الهاتف
                  </label>
                  <input
                    type="text"
                    value={phone}
                    onChange={(e) => setPhone(sanitizePhoneInput(e.target.value))}
                    placeholder="01200000000"
                    className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-900 dark:text-white dir-ltr text-right focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                  حالة الحساب
                </label>
                <select
                  value={status}
                  disabled={!editingWorker}
                  onChange={(e) => setStatus(e.target.value as any)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500 cursor-pointer"
                >
                  <option value="active">مفعل (Active)</option>
                  <option value="inactive">معطل (Disabled)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                  ملاحظات إضافية
                </label>
                <textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="ملاحظات حول الموظف أو أوقات عمله..."
                  className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-medium text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500 resize-none"
                />
              </div>

              {/* Form Footer Buttons */}
              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-extrabold text-xs rounded-xl transition-colors cursor-pointer"
                >
                  {t('cancel')}
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="px-5 py-2.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-xs rounded-xl shadow-md shadow-amber-500/20 transition-colors cursor-pointer"
                >
                  {isSaving ? 'جارٍ الحفظ...' : t('save')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
