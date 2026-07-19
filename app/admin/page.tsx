'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  ShieldAlert,
  Key,
  Database,
  PlusCircle,
  RefreshCw,
  Copy,
  Check,
  Trash2,
  Lock,
  Layers,
  Sparkles,
  ArrowLeft,
  Search,
  Download,
  AlertCircle,
  CheckCircle2,
  FileText,
  Tag,
  History,
  Megaphone,
} from 'lucide-react';

interface Stats {
  totalAccounts: number;
  availableAccounts: number;
  usedAccounts: number;
  totalCdks: number;
  unusedCdks: number;
  redeemedCdks: number;
}

export default function AdminPage() {
  const [adminSecret, setAdminSecret] = useState('');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<'overview' | 'accounts' | 'cdks' | 'history'>('overview');
  const [stats, setStats] = useState<Stats | null>(null);
  const [loadingStats, setLoadingStats] = useState(false);

  // Accounts Tab State
  const [rawAccountsInput, setRawAccountsInput] = useState('');
  const [accountType, setAccountType] = useState('PLUS');
  const [importing, setImporting] = useState(false);
  const [accountsList, setAccountsList] = useState<any[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [accountStatusFilter, setAccountStatusFilter] = useState('');

  // CDKs Tab State
  const [cdkMode, setCdkMode] = useState<'generate' | 'import'>('generate');
  const [cdkType, setCdkType] = useState('PLUS');
  const [cdkCount, setCdkCount] = useState(5);
  const [customCdksInput, setCustomCdksInput] = useState('');
  const [cdkNote, setCdkNote] = useState('');
  const [generatingCdk, setGeneratingCdk] = useState(false);
  const [newGeneratedCodes, setNewGeneratedCodes] = useState<string[]>([]);
  const [cdksList, setCdksList] = useState<any[]>([]);
  const [loadingCdks, setLoadingCdks] = useState(false);
  const [cdkStatusFilter, setCdkStatusFilter] = useState('');

  // History & Announcement Tab State
  const [historyList, setHistoryList] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historySearch, setHistorySearch] = useState('');

  const [announcementMsg, setAnnouncementMsg] = useState('');
  const [announcementEnabled, setAnnouncementEnabled] = useState(true);
  const [savingAnnouncement, setSavingAnnouncement] = useState(false);

  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [copiedText, setCopiedText] = useState<string | null>(null);

  useEffect(() => {
    const storedSecret = localStorage.getItem('cdk_admin_secret');
    if (storedSecret) {
      setAdminSecret(storedSecret);
      verifySecret(storedSecret);
    }
  }, []);

  const verifySecret = async (secretToTest: string) => {
    setAuthError(null);
    try {
      const res = await fetch(`/api/admin/stats?secret=${encodeURIComponent(secretToTest)}`);
      const data = await res.json();
      if (res.ok && data.status === 'success') {
        setIsAuthenticated(true);
        localStorage.setItem('cdk_admin_secret', secretToTest);
        setStats(data.stats);
      } else {
        setAuthError(data.message || 'Mật khẩu Admin không chính xác!');
        setIsAuthenticated(false);
      }
    } catch (err) {
      setAuthError('Không thể kết nối đến server!');
      setIsAuthenticated(false);
    }
  };

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminSecret.trim()) {
      setAuthError('Vui lòng nhập mật khẩu Admin');
      return;
    }
    verifySecret(adminSecret.trim());
  };

  const handleLogout = () => {
    localStorage.removeItem('cdk_admin_secret');
    setIsAuthenticated(false);
    setAdminSecret('');
  };

  const fetchStats = async () => {
    setLoadingStats(true);
    try {
      const res = await fetch(`/api/admin/stats?secret=${encodeURIComponent(adminSecret)}`);
      const data = await res.json();
      if (data.status === 'success') {
        setStats(data.stats);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingStats(false);
    }
  };

  const fetchAccounts = async () => {
    setLoadingAccounts(true);
    try {
      const url = `/api/admin/accounts?limit=200${accountStatusFilter ? `&status=${accountStatusFilter}` : ''}`;
      const res = await fetch(url, {
        headers: { 'x-admin-secret': adminSecret },
      });
      const data = await res.json();
      if (data.status === 'success') {
        setAccountsList(data.accounts);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingAccounts(false);
    }
  };

  const fetchCdks = async () => {
    setLoadingCdks(true);
    try {
      const url = `/api/admin/cdks?limit=200${cdkStatusFilter ? `&status=${cdkStatusFilter}` : ''}`;
      const res = await fetch(url, {
        headers: { 'x-admin-secret': adminSecret },
      });
      const data = await res.json();
      if (data.status === 'success') {
        setCdksList(data.cdks);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingCdks(false);
    }
  };

  const fetchHistory = async () => {
    setLoadingHistory(true);
    try {
      const url = `/api/admin/history?limit=200${historySearch ? `&q=${encodeURIComponent(historySearch)}` : ''}`;
      const res = await fetch(url, {
        headers: { 'x-admin-secret': adminSecret },
      });
      const data = await res.json();
      if (data.status === 'success') {
        setHistoryList(data.history);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingHistory(false);
    }
  };

  const fetchAnnouncement = async () => {
    try {
      const res = await fetch('/api/admin/announcement');
      const data = await res.json();
      if (data.status === 'success') {
        setAnnouncementMsg(data.announcement || '');
        setAnnouncementEnabled(data.enabled ?? true);
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    if (isAuthenticated) {
      fetchStats();
      fetchAnnouncement();
      if (activeTab === 'accounts') fetchAccounts();
      if (activeTab === 'cdks') fetchCdks();
      if (activeTab === 'history') fetchHistory();
    }
  }, [isAuthenticated, activeTab, accountStatusFilter, cdkStatusFilter, historySearch]);

  const showToast = (type: 'success' | 'error', message: string) => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 4000);
  };

  const handleCopy = (text: string, label?: string) => {
    navigator.clipboard.writeText(text);
    setCopiedText(text);
    showToast('success', `Đã copy ${label || 'dữ liệu'}!`);
    setTimeout(() => setCopiedText(null), 2000);
  };

  const handleImportAccounts = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rawAccountsInput.trim()) {
      showToast('error', 'Vui lòng nhập danh sách tài khoản!');
      return;
    }

    setImporting(true);
    try {
      const res = await fetch('/api/admin/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: adminSecret, rawText: rawAccountsInput, type: accountType }),
      });
      const data = await res.json();
      if (res.ok && data.status === 'success') {
        showToast('success', data.message);
        setRawAccountsInput('');
        fetchStats();
        fetchAccounts();
      } else {
        showToast('error', data.message || 'Lỗi khi nhập kho tài khoản');
      }
    } catch (err: any) {
      showToast('error', 'Lỗi kết nối máy chủ!');
    } finally {
      setImporting(false);
    }
  };

  const handleCdkSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setGeneratingCdk(true);
    try {
      const payload: any = {
        secret: adminSecret,
        mode: cdkMode,
        type: cdkType,
        note: cdkNote,
      };

      if (cdkMode === 'generate') {
        payload.count = cdkCount;
      } else {
        payload.customCodesText = customCdksInput;
      }

      const res = await fetch('/api/admin/cdks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok && data.status === 'success') {
        showToast('success', data.message);
        setNewGeneratedCodes(data.codes || []);
        if (cdkMode === 'import') setCustomCdksInput('');
        fetchStats();
        fetchCdks();
      } else {
        showToast('error', data.message || 'Lỗi khi xử lý mã CDK');
      }
    } catch (err: any) {
      showToast('error', 'Lỗi kết nối máy chủ!');
    } finally {
      setGeneratingCdk(false);
    }
  };

  const handleSaveAnnouncement = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingAnnouncement(true);
    try {
      const res = await fetch('/api/admin/announcement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          secret: adminSecret,
          announcement: announcementMsg,
          enabled: announcementEnabled,
        }),
      });
      const data = await res.json();
      if (res.ok && data.status === 'success') {
        showToast('success', data.message);
      } else {
        showToast('error', data.message || 'Lỗi khi lưu thông báo');
      }
    } catch (e) {
      showToast('error', 'Lỗi kết nối máy chủ!');
    } finally {
      setSavingAnnouncement(false);
    }
  };

  const handleClearAccounts = async () => {
    if (!confirm('Bạn có chắc chắn muốn xóa TOÀN BỘ tài khoản trong kho?')) return;
    try {
      const res = await fetch('/api/admin/accounts', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: adminSecret, action: 'clear_all' }),
      });
      const data = await res.json();
      if (data.status === 'success') {
        showToast('success', data.message);
        fetchStats();
        fetchAccounts();
      }
    } catch (e) {
      showToast('error', 'Lỗi khi dọn kho');
    }
  };

  const handleClearCdks = async () => {
    if (!confirm('Bạn có chắc chắn muốn xóa TOÀN BỘ mã CDK?')) return;
    try {
      const res = await fetch('/api/admin/cdks', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: adminSecret, action: 'clear_all' }),
      });
      const data = await res.json();
      if (data.status === 'success') {
        showToast('success', data.message);
        fetchStats();
        fetchCdks();
      }
    } catch (e) {
      showToast('error', 'Lỗi khi dọn mã CDK');
    }
  };

  const insertSampleFormat = () => {
    const sample = `LeoSolis1430@outlook.com----KT8po9EHwz5L1EJ----9e5f94bc-e8a4-4e73-b8be-63364c29d753----M.C504_BAY.0.U.MsaArtifacts...`;
    setRawAccountsInput((prev) => (prev ? prev + '\n' + sample : sample));
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen w-full bg-[#070b14] text-slate-100 flex items-center justify-center p-4 font-sans relative overflow-x-hidden">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] bg-indigo-600/15 blur-[120px] rounded-full pointer-events-none" />

        <div className="max-w-md w-full bg-slate-900/90 backdrop-blur-xl border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-2xl relative z-10 mx-auto">
          <div className="text-center mb-6">
            <div className="w-12 h-12 bg-indigo-500/10 border border-indigo-500/30 rounded-2xl flex items-center justify-center mx-auto mb-3 text-indigo-400">
              <Lock className="w-6 h-6" />
            </div>
            <h1 className="text-2xl font-bold text-white">Quản Trị Hệ Thống CDK</h1>
            <p className="text-xs text-slate-400 mt-1">Vui lòng nhập mật khẩu Admin Secret để tiếp tục</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                Admin Secret Password
              </label>
              <input
                type="password"
                value={adminSecret}
                onChange={(e) => setAdminSecret(e.target.value)}
                placeholder="Nhập mật khẩu admin..."
                className="w-full px-4 py-3 bg-slate-950 border border-slate-800 rounded-xl text-white focus:outline-none focus:border-indigo-500 text-sm font-mono"
              />
            </div>

            {authError && (
              <div className="p-3 bg-red-950/60 border border-red-800/60 text-red-300 text-xs rounded-xl flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                <span>{authError}</span>
              </div>
            )}

            <button
              type="submit"
              className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-xl text-sm transition-all shadow-lg shadow-indigo-600/30 cursor-pointer"
            >
              Đăng Nhập Quản Trị
            </button>
          </form>

          <div className="mt-6 pt-4 border-t border-slate-800/80 text-center">
            <Link href="/" className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors">
              <ArrowLeft className="w-3.5 h-3.5" /> Quay lại trang đổi mã
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full bg-[#070b14] text-slate-100 font-sans relative overflow-x-hidden flex flex-col items-center">
      {/* Toast Notification */}
      {notification && (
        <div
          className={`fixed top-5 right-5 z-50 p-4 rounded-xl border shadow-2xl flex items-center gap-3 text-sm animate-bounce ${
            notification.type === 'success'
              ? 'bg-emerald-950/90 border-emerald-500/50 text-emerald-200'
              : 'bg-red-950/90 border-red-500/50 text-red-200'
          }`}
        >
          {notification.type === 'success' ? <CheckCircle2 className="w-5 h-5 text-emerald-400" /> : <AlertCircle className="w-5 h-5 text-red-400" />}
          <span>{notification.message}</span>
        </div>
      )}

      <div className="w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-4 sm:py-6 lg:py-8">
      {/* Main Admin Header */}
      <header className="w-full flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8 pb-6 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-indigo-500/10 border border-indigo-500/30 text-indigo-400">
              <ShieldAlert className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white flex items-center gap-2">
                Trang Quản Trị Hệ Thống CDK
              </h1>
              <p className="text-xs text-slate-400">Quản lý kho tài khoản, phát hành mã CDK và xem nhật ký tin nhắn</p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-xl transition-all flex items-center gap-1.5"
          >
            <ArrowLeft className="w-4 h-4" /> Trang Khách Đổi Mã
          </Link>

          <button
            onClick={handleLogout}
            className="px-3.5 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 text-xs font-semibold rounded-xl transition-all cursor-pointer"
          >
            Đăng Xuất
          </button>
        </div>
      </header>

      <div className="w-full space-y-6">
        {/* Navigation Tabs */}
        <div className="flex flex-wrap items-center gap-2 p-1.5 bg-slate-900/90 border border-slate-800 rounded-2xl w-fit">
          <button
            onClick={() => setActiveTab('overview')}
            className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all flex items-center gap-2 cursor-pointer ${
              activeTab === 'overview' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
            }`}
          >
            <Layers className="w-4 h-4" /> Thống Kê Tổng Quan
          </button>

          <button
            onClick={() => setActiveTab('accounts')}
            className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all flex items-center gap-2 cursor-pointer ${
              activeTab === 'accounts' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
            }`}
          >
            <Database className="w-4 h-4" /> Kho Tài Khoản
          </button>

          <button
            onClick={() => setActiveTab('cdks')}
            className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all flex items-center gap-2 cursor-pointer ${
              activeTab === 'cdks' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
            }`}
          >
            <Key className="w-4 h-4" /> Tạo & Nhập Mã CDK
          </button>

          <button
            onClick={() => setActiveTab('history')}
            className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all flex items-center gap-2 cursor-pointer ${
              activeTab === 'history' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
            }`}
          >
            <History className="w-4 h-4" /> Lịch Sử & Tin Nhắn
          </button>
        </div>

        {/* TAB 1: OVERVIEW */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-white">Chỉ Số Tổng Quan</h2>
              <button
                onClick={fetchStats}
                className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl transition-all cursor-pointer"
                title="Làm mới thống kê"
              >
                <RefreshCw className={`w-4 h-4 ${loadingStats ? 'animate-spin' : ''}`} />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              <div className="bg-slate-900/80 border border-emerald-500/30 rounded-2xl p-5 shadow-xl">
                <div className="text-xs font-semibold text-emerald-400 uppercase tracking-wider mb-2">
                  Tài Khoản Khả Dụng (Sẵn Có)
                </div>
                <div className="text-3xl font-extrabold text-white">{stats?.availableAccounts ?? 0}</div>
                <p className="text-xs text-slate-400 mt-2">Sẵn sàng để khách đổi qua CDK</p>
              </div>

              <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 shadow-xl">
                <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                  Tài Khoản Đã Cấp (Đã Dùng)
                </div>
                <div className="text-3xl font-extrabold text-purple-400">{stats?.usedAccounts ?? 0}</div>
                <p className="text-xs text-slate-400 mt-2">Tổng tài khoản đã được người dùng nhận</p>
              </div>

              <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 shadow-xl">
                <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                  Tổng Số Tài Khoản Trong Kho
                </div>
                <div className="text-3xl font-extrabold text-indigo-400">{stats?.totalAccounts ?? 0}</div>
                <p className="text-xs text-slate-400 mt-2">Bao gồm tất cả các gói</p>
              </div>

              <div className="bg-slate-900/80 border border-indigo-500/30 rounded-2xl p-5 shadow-xl">
                <div className="text-xs font-semibold text-indigo-400 uppercase tracking-wider mb-2">
                  Mã CDK Chưa Sử Dụng
                </div>
                <div className="text-3xl font-extrabold text-white">{stats?.unusedCdks ?? 0}</div>
                <p className="text-xs text-slate-400 mt-2">Có thể phát hành cho khách hàng</p>
              </div>

              <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 shadow-xl">
                <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                  Mã CDK Đã Đổi Thành Công
                </div>
                <div className="text-3xl font-extrabold text-emerald-400">{stats?.redeemedCdks ?? 0}</div>
                <p className="text-xs text-slate-400 mt-2">Mã đã kích hoạt tài khoản</p>
              </div>

              <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 shadow-xl">
                <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                  Tổng Số Mã CDK Trong Hệ Thống
                </div>
                <div className="text-3xl font-extrabold text-blue-400">{stats?.totalCdks ?? 0}</div>
                <p className="text-xs text-slate-400 mt-2">Tất cả các loại mã</p>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: BULK ACCOUNTS IMPORT */}
        {activeTab === 'accounts' && (
          <div className="space-y-6">
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h2 className="text-lg font-bold text-white flex items-center gap-2">
                    <PlusCircle className="w-5 h-5 text-indigo-400" /> Nhập Kho Tài Khoản Hàng Loạt
                  </h2>
                  <p className="text-xs text-slate-400">
                    Hỗ trợ tất cả định dạng: <code className="text-indigo-300 font-mono">email|password|token|id</code> hoặc <code className="text-indigo-300 font-mono">email----password----id----token</code> (Mỗi dòng 1 tài khoản).
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5">
                    <Tag className="w-3.5 h-3.5 text-indigo-400" />
                    <span className="text-xs text-slate-300 font-medium">Gói Tài Khoản:</span>
                    <select
                      value={accountType}
                      onChange={(e) => setAccountType(e.target.value.toUpperCase())}
                      className="bg-slate-950 border border-slate-800 text-indigo-300 font-bold rounded-xl px-3 py-1.5 text-xs focus:outline-none focus:border-indigo-500"
                    >
                      <option value="PLUS">PLUS (Mặc định)</option>
                      <option value="PRO">PRO</option>
                      <option value="BUSINESS">BUSINESS</option>
                      <option value="STANDARD">STANDARD</option>
                    </select>
                  </div>

                  <button
                    type="button"
                    onClick={insertSampleFormat}
                    className="px-3 py-1.5 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 text-xs font-semibold rounded-xl transition-all cursor-pointer"
                  >
                    + Dán Mẫu Ví Dụ
                  </button>
                </div>
              </div>

              <form onSubmit={handleImportAccounts} className="space-y-4">
                <div>
                  <textarea
                    rows={6}
                    value={rawAccountsInput}
                    onChange={(e) => setRawAccountsInput(e.target.value)}
                    placeholder={`LeoSolis1430@outlook.com----KT8po9EHwz5L1EJ----9e5f94bc-e8a4-4e73-b8be-63364c29d753----M.C504_BAY...\nCalebOlson9556@outlook.com|auywulp9906|M.C508_BAY...|9e5f94bc-e8a4-4e73-b8be-63364c29d753`}
                    className="w-full p-4 bg-slate-950 border border-slate-800 rounded-xl font-mono text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-indigo-500 leading-relaxed resize-y"
                  />
                  <div className="flex justify-between items-center text-xs text-slate-500 mt-1">
                    <span>
                      Đã phát hiện: <strong className="text-indigo-400">{rawAccountsInput.split('\n').filter((l) => l.trim()).length}</strong> tài khoản [Gói: {accountType}]
                    </span>
                    <span>Tự động nhận diện định dạng `----` và `|`</span>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2">
                  <button
                    type="submit"
                    disabled={importing || !rawAccountsInput.trim()}
                    className="px-6 py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm rounded-xl transition-all shadow-lg shadow-indigo-600/30 flex items-center gap-2 cursor-pointer disabled:opacity-50"
                  >
                    {importing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Database className="w-4 h-4" />}
                    Nhập Hàng Loạt Vào Kho [Gói: {accountType}]
                  </button>

                  <button
                    type="button"
                    onClick={handleClearAccounts}
                    className="px-4 py-2 bg-red-950/40 hover:bg-red-900/60 text-red-400 border border-red-900/60 text-xs font-semibold rounded-xl transition-all flex items-center gap-1.5 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Dọn Sạch Kho Tài Khoản
                  </button>
                </div>
              </form>
            </div>

            {/* Accounts Table */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <h3 className="text-base font-bold text-white">Danh Sách Tài Khoản Trong Kho</h3>

                <div className="flex items-center gap-3">
                  <select
                    value={accountStatusFilter}
                    onChange={(e) => setAccountStatusFilter(e.target.value)}
                    className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-slate-300 focus:outline-none"
                  >
                    <option value="">Tất cả trạng thái</option>
                    <option value="available">Khả dụng (Available)</option>
                    <option value="used">Đã dùng (Used)</option>
                  </select>

                  <button
                    onClick={fetchAccounts}
                    className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl transition-all cursor-pointer"
                  >
                    <RefreshCw className={`w-4 h-4 ${loadingAccounts ? 'animate-spin' : ''}`} />
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-950 text-slate-400 uppercase tracking-wider">
                    <tr>
                      <th className="p-3 rounded-l-xl">Email</th>
                      <th className="p-3">Gói</th>
                      <th className="p-3">Mật khẩu</th>
                      <th className="p-3">Account ID</th>
                      <th className="p-3">Trạng thái</th>
                      <th className="p-3">Mã CDK Đã Đổi</th>
                      <th className="p-3 rounded-r-xl text-right">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 text-slate-300 font-mono">
                    {accountsList.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="p-6 text-center text-slate-500 font-sans">
                          Chưa có tài khoản nào trong kho.
                        </td>
                      </tr>
                    ) : (
                      accountsList.map((acc) => (
                        <tr key={acc._id} className="hover:bg-slate-800/30 transition-colors">
                          <td className="p-3 font-semibold text-indigo-300">{acc.email || 'N/A'}</td>
                          <td className="p-3 font-sans">
                            <span className="px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 text-[10px] font-bold">
                              {acc.type || 'PLUS'}
                            </span>
                          </td>
                          <td className="p-3">{acc.password || 'N/A'}</td>
                          <td className="p-3 text-slate-400">{acc.accountId ? `${acc.accountId.slice(0, 14)}...` : 'N/A'}</td>
                          <td className="p-3 font-sans">
                            {acc.status === 'available' ? (
                              <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[10px] font-semibold">
                                Khả dụng
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/20 text-[10px] font-semibold">
                                Đã dùng
                              </span>
                            )}
                          </td>
                          <td className="p-3 text-emerald-400">{acc.usedByCdk || '-'}</td>
                          <td className="p-3 text-right font-sans">
                            <button
                              onClick={() => handleCopy(acc.raw, 'tài khoản thô')}
                              className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-[11px] font-medium transition-all inline-flex items-center gap-1 cursor-pointer"
                            >
                              <Copy className="w-3 h-3" /> Copy
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: CDK GENERATOR & CUSTOM IMPORT */}
        {activeTab === 'cdks' && (
          <div className="space-y-6">
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-3 border-b border-slate-800">
                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-purple-400" /> Quản Lý Mã CDK Kích Hoạt
                </h2>

                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5">
                    <Tag className="w-3.5 h-3.5 text-purple-400" />
                    <span className="text-xs text-slate-300 font-medium">Loại Mã CDK:</span>
                    <select
                      value={cdkType}
                      onChange={(e) => setCdkType(e.target.value.toUpperCase())}
                      className="bg-slate-950 border border-slate-800 text-purple-300 font-bold rounded-xl px-3 py-1.5 text-xs focus:outline-none focus:border-purple-500"
                    >
                      <option value="PLUS">PLUS (Prefix: PLUS-)</option>
                      <option value="PRO">PRO (Prefix: PRO-)</option>
                      <option value="BUSINESS">BUSINESS (Prefix: BUSINESS-)</option>
                      <option value="STANDARD">STANDARD (Prefix: STANDARD-)</option>
                    </select>
                  </div>

                  <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800">
                    <button
                      type="button"
                      onClick={() => setCdkMode('generate')}
                      className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                        cdkMode === 'generate' ? 'bg-purple-600 text-white' : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      Tự Động Sinh Mã
                    </button>
                    <button
                      type="button"
                      onClick={() => setCdkMode('import')}
                      className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                        cdkMode === 'import' ? 'bg-purple-600 text-white' : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      Nhập Thủ Công
                    </button>
                  </div>
                </div>
              </div>

              <form onSubmit={handleCdkSubmit} className="space-y-4">
                {cdkMode === 'generate' ? (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                        Số Lượng Mã CDK {cdkType} Cần Sinh
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={100}
                        value={cdkCount}
                        onChange={(e) => setCdkCount(parseInt(e.target.value, 10) || 1)}
                        className="w-full px-4 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-white font-mono text-sm focus:outline-none focus:border-indigo-500"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                        Ghi Chú Đợt Phát Hành (Tùy chọn)
                      </label>
                      <input
                        type="text"
                        placeholder="VD: Đợt bán gói PLUS 20/07..."
                        value={cdkNote}
                        onChange={(e) => setCdkNote(e.target.value)}
                        className="w-full px-4 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-white text-sm focus:outline-none focus:border-indigo-500"
                      />
                    </div>

                    <div className="flex items-end">
                      <button
                        type="submit"
                        disabled={generatingCdk}
                        className="w-full py-2.5 px-6 bg-purple-600 hover:bg-purple-500 text-white font-semibold text-sm rounded-xl transition-all shadow-lg shadow-purple-600/30 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                      >
                        {generatingCdk ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Key className="w-4 h-4" />}
                        Sinh {cdkCount} Mã CDK {cdkType}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                        Dán Danh Sách Mã CDK {cdkType} Tự Chọn (Mỗi dòng 1 mã hoặc dấu phẩy)
                      </label>
                      <textarea
                        rows={5}
                        value={customCdksInput}
                        onChange={(e) => setCustomCdksInput(e.target.value)}
                        placeholder={`PLUS-VIPCODE123\nPLUS-VIPCODE456`}
                        className="w-full p-4 bg-slate-950 border border-slate-800 rounded-xl font-mono text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-purple-500 leading-relaxed uppercase"
                      />
                      <div className="text-xs text-slate-500 mt-1">
                        Đã phát hiện: <strong className="text-purple-400">{customCdksInput.split(/[\r\n,;]+/).filter((l) => l.trim()).length}</strong> mã CDK [Gói: {cdkType}]
                      </div>
                    </div>

                    <div className="flex items-center justify-between">
                      <input
                        type="text"
                        placeholder="Ghi chú đợt nhập mã..."
                        value={cdkNote}
                        onChange={(e) => setCdkNote(e.target.value)}
                        className="w-1/2 px-4 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white text-xs focus:outline-none"
                      />

                      <button
                        type="submit"
                        disabled={generatingCdk || !customCdksInput.trim()}
                        className="px-6 py-2.5 bg-purple-600 hover:bg-purple-500 text-white font-semibold text-sm rounded-xl transition-all shadow-lg shadow-purple-600/30 flex items-center gap-2 cursor-pointer disabled:opacity-50"
                      >
                        {generatingCdk ? <RefreshCw className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
                        Nhập Mã CDK {cdkType}
                      </button>
                    </div>
                  </div>
                )}

                {/* Newly generated showcase */}
                {newGeneratedCodes.length > 0 && (
                  <div className="mt-4 p-4 rounded-xl bg-purple-950/40 border border-purple-800/60 animate-fadeIn">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-xs font-bold text-purple-300 uppercase tracking-wider">
                        Mã CDK Gói [{cdkType}] Vừa Thêm ({newGeneratedCodes.length} mã)
                      </span>
                      <button
                        type="button"
                        onClick={() => handleCopy(newGeneratedCodes.join('\n'), 'tất cả mã CDK')}
                        className="px-3 py-1 bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold rounded-lg transition-all flex items-center gap-1.5 cursor-pointer"
                      >
                        <Copy className="w-3.5 h-3.5" /> Copy Tất Cả Mã
                      </button>
                    </div>
                    <div className="bg-slate-950 p-3 rounded-lg font-mono text-xs text-slate-200 max-h-40 overflow-y-auto space-y-1">
                      {newGeneratedCodes.map((c) => (
                        <div key={c} className="flex justify-between items-center hover:bg-slate-900 px-2 py-0.5 rounded">
                          <span className="text-purple-300">{c}</span>
                          <button
                            type="button"
                            onClick={() => handleCopy(c, 'mã CDK')}
                            className="text-slate-500 hover:text-slate-300 text-[10px]"
                          >
                            Copy
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </form>
            </div>

            {/* CDKs Table */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <h3 className="text-base font-bold text-white">Danh Sách Mã CDK</h3>
                  <button
                    onClick={handleClearCdks}
                    className="px-3 py-1 bg-red-950/40 hover:bg-red-900/60 text-red-400 border border-red-900/60 text-xs font-semibold rounded-xl transition-all flex items-center gap-1 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Dọn Sạch CDK
                  </button>
                </div>

                <div className="flex items-center gap-3">
                  <select
                    value={cdkStatusFilter}
                    onChange={(e) => setCdkStatusFilter(e.target.value)}
                    className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-slate-300 focus:outline-none"
                  >
                    <option value="">Tất cả trạng thái</option>
                    <option value="unused">Chưa sử dụng (Unused)</option>
                    <option value="redeemed">Đã đổi (Redeemed)</option>
                  </select>

                  <button
                    onClick={fetchCdks}
                    className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl transition-all cursor-pointer"
                  >
                    <RefreshCw className={`w-4 h-4 ${loadingCdks ? 'animate-spin' : ''}`} />
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-950 text-slate-400 uppercase tracking-wider">
                    <tr>
                      <th className="p-3 rounded-l-xl">Mã CDK</th>
                      <th className="p-3">Gói</th>
                      <th className="p-3">Trạng thái</th>
                      <th className="p-3">Tài Khoản Đã Cấp</th>
                      <th className="p-3">Ghi chú</th>
                      <th className="p-3">Thời gian tạo</th>
                      <th className="p-3 rounded-r-xl text-right">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 text-slate-300 font-mono">
                    {cdksList.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="p-6 text-center text-slate-500 font-sans">
                          Chưa có mã CDK nào.
                        </td>
                      </tr>
                    ) : (
                      cdksList.map((c) => (
                        <tr key={c._id} className="hover:bg-slate-800/30 transition-colors">
                          <td className="p-3 font-semibold text-purple-300">{c.code}</td>
                          <td className="p-3 font-sans">
                            <span className="px-2 py-0.5 rounded bg-purple-500/10 text-purple-300 border border-purple-500/20 text-[10px] font-bold">
                              {c.type || 'PLUS'}
                            </span>
                          </td>
                          <td className="p-3 font-sans">
                            {c.status === 'unused' ? (
                              <span className="px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 text-[10px] font-semibold">
                                Chưa dùng
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[10px] font-semibold">
                                Đã đổi
                              </span>
                            )}
                          </td>
                          <td className="p-3 text-slate-400 truncate max-w-[180px]">
                            {c.redeemedAccountData ? c.redeemedAccountData.split(/[\-|]/)[0] : '-'}
                          </td>
                          <td className="p-3 text-slate-400 font-sans">{c.note || '-'}</td>
                          <td className="p-3 text-slate-500 text-[11px] font-sans">
                            {c.createdAt ? new Date(c.createdAt).toLocaleString('vi-VN') : '-'}
                          </td>
                          <td className="p-3 text-right font-sans">
                            <button
                              onClick={() => handleCopy(c.code, 'mã CDK')}
                              className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-[11px] font-medium transition-all inline-flex items-center gap-1 cursor-pointer"
                            >
                              <Copy className="w-3 h-3" /> Copy
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: HISTORY & ANNOUNCEMENT MESSAGES */}
        {activeTab === 'history' && (
          <div className="space-y-6">
            {/* Announcement Message Manager Card */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                  <Megaphone className="w-5 h-5 text-indigo-400" /> Quản Lý Tin Nhắn / Thông Báo Ngoài Trang Chủ
                </h2>
              </div>

              <form onSubmit={handleSaveAnnouncement} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                    Nội dung tin nhắn phát thông báo cho khách hàng
                  </label>
                  <textarea
                    rows={3}
                    value={announcementMsg}
                    onChange={(e) => setAnnouncementMsg(e.target.value)}
                    placeholder="VD: 📢 Shop vừa cập nhật thêm 100 tài khoản ChatGPT Plus mới! Quý khách có thể đổi ngay bằng mã CDK..."
                    className="w-full p-4 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-indigo-500 leading-relaxed"
                  />
                </div>

                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 text-xs text-slate-300 font-medium cursor-pointer">
                    <input
                      type="checkbox"
                      checked={announcementEnabled}
                      onChange={(e) => setAnnouncementEnabled(e.target.checked)}
                      className="w-4 h-4 rounded border-slate-800 text-indigo-600 focus:ring-indigo-500 bg-slate-950"
                    />
                    Bật hiển thị thanh thông báo ngoài trang chủ khách đổi mã
                  </label>

                  <button
                    type="submit"
                    disabled={savingAnnouncement}
                    className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs rounded-xl transition-all shadow-lg shadow-indigo-600/30 flex items-center gap-2 cursor-pointer disabled:opacity-50"
                  >
                    {savingAnnouncement ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                    Lưu Tin Nhắn Thông Báo
                  </button>
                </div>
              </form>
            </div>

            {/* Redemption History Table */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <History className="w-5 h-5 text-emerald-400" /> Nhật Ký Lịch Sử Khách Đổi Mã CDK
                </h3>

                <div className="flex items-center gap-3">
                  <div className="relative">
                    <input
                      type="text"
                      placeholder="Tìm theo mã CDK hoặc Email..."
                      value={historySearch}
                      onChange={(e) => setHistorySearch(e.target.value)}
                      className="pl-8 pr-3 py-1.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                    />
                    <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  </div>

                  <button
                    onClick={fetchHistory}
                    className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl transition-all cursor-pointer"
                  >
                    <RefreshCw className={`w-4 h-4 ${loadingHistory ? 'animate-spin' : ''}`} />
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-950 text-slate-400 uppercase tracking-wider">
                    <tr>
                      <th className="p-3 rounded-l-xl">Mã CDK</th>
                      <th className="p-3">Gói</th>
                      <th className="p-3">Tài Khoản Đã Cấp</th>
                      <th className="p-3">Thời gian đổi</th>
                      <th className="p-3 rounded-r-xl text-right">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 text-slate-300 font-mono">
                    {historyList.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="p-6 text-center text-slate-500 font-sans">
                          Chưa có lượt đổi mã nào trong nhật ký.
                        </td>
                      </tr>
                    ) : (
                      historyList.map((item) => (
                        <tr key={item._id} className="hover:bg-slate-800/30 transition-colors">
                          <td className="p-3 font-semibold text-purple-300">{item.code}</td>
                          <td className="p-3 font-sans">
                            <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[10px] font-bold">
                              {item.type || 'PLUS'}
                            </span>
                          </td>
                          <td className="p-3 text-slate-200 font-mono max-w-[300px] truncate" title={item.redeemedAccountData}>
                            {item.redeemedAccountData || '-'}
                          </td>
                          <td className="p-3 text-slate-400 text-[11px] font-sans">
                            {item.redeemedAt ? new Date(item.redeemedAt).toLocaleString('vi-VN') : '-'}
                          </td>
                          <td className="p-3 text-right font-sans">
                            <button
                              onClick={() => handleCopy(item.redeemedAccountData || item.code, 'tài khoản')}
                              className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-[11px] font-medium transition-all inline-flex items-center gap-1 cursor-pointer"
                            >
                              <Copy className="w-3 h-3" /> Copy Chuỗi
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
      </div>
    </div>
  );
}
