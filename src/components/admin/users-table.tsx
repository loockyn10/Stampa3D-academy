"use client";

import React, { useEffect, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { Loader2, CheckCircle2, AlertCircle, Shield, Star, ShieldOff } from "lucide-react";

type Profile = {
  id: string;
  email: string;
  full_name: string;
  display_name: string;
  role: "member" | "admin" | "instructor";
  membership_status: "active" | "inactive" | "cancelled" | "expired";
  member_level: "bronze" | "silver" | "gold" | "elite";
  active_months: number;
  created_at: string;
  subscriptions?: any[];
  betaGrant?: any;
  founderData?: any;
};

type BetaModalData = {
  userId: string;
  name: string;
  existingGrant?: any;
};

export function UsersTable() {
  const [users, setUsers] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [betaModal, setBetaModal] = useState<BetaModalData | null>(null);
  const [betaNotes, setBetaNotes] = useState("");
  const [betaExpires, setBetaExpires] = useState("");
  const [betaLoading, setBetaLoading] = useState(false);

  const supabase = createClient();

  const fetchUsers = async () => {
    setLoading(true);
    setError(null);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setError("No has iniciado sesión."); setLoading(false); return; }

      const { data: currentUserProfile, error: profileError } = await supabase
        .from("profiles").select("role").eq("id", user.id).single();

      if (profileError || currentUserProfile?.role !== "admin") {
        setError("Acceso denegado: Se requiere rol de administrador.");
        setLoading(false);
        return;
      }

      const { data: profilesData, error: fetchError } = await supabase
        .from("profiles").select("*").order("created_at", { ascending: false });

      if (fetchError) { setError(fetchError.message); setLoading(false); return; }

      const userIds = (profilesData || []).map((p) => p.id);
      let subscriptionsData: any[] = [];
      let grantsData: any[] = [];
      let foundersData: any[] = [];

      if (userIds.length > 0) {
        const [subsRes, grantsRes, foundersRes] = await Promise.all([
          supabase.from("subscriptions").select("*").in("user_id", userIds).order("created_at", { ascending: false }),
          supabase.from("user_access_grants").select("*").in("user_id", userIds).eq("status", "active"),
          supabase.from("founder_members").select("*").in("user_id", userIds),
        ]);

        subscriptionsData = subsRes.data || [];
        grantsData = grantsRes.data || [];
        foundersData = foundersRes.data || [];
      }

      const usersEnriched = (profilesData || []).map((profile) => ({
        ...profile,
        subscriptions: subscriptionsData.filter((s) => s.user_id === profile.id),
        betaGrant: grantsData.find((g) => g.user_id === profile.id && ["beta_tester", "manual_free_access", "internal_tester"].includes(g.grant_type)) || null,
        founderData: foundersData.find((f) => f.user_id === profile.id) || null,
      }));

      setUsers(usersEnriched as Profile[]);
    } catch (err: any) {
      setError(err.message || "Error inesperado al cargar usuarios");
    }

    setLoading(false);
  };

  useEffect(() => { fetchUsers(); }, []);

  const showSuccess = (msg: string) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(null), 3000);
  };

  const handleUpdate = async (id: string, field: keyof Profile, value: any) => {
    setUpdatingId(id);
    setError(null);
    const { error: updateError } = await supabase.from("profiles").update({ [field]: value }).eq("id", id);
    if (updateError) {
      setError(updateError.message);
    } else {
      setUsers((prev) => prev.map((u) => u.id === id ? { ...u, [field]: value } : u));
      showSuccess("Usuario actualizado correctamente.");
    }
    setUpdatingId(null);
  };

  const handleGrantBeta = async () => {
    if (!betaModal) return;
    setBetaLoading(true);

    const { data: { user } } = await supabase.auth.getUser();

    const payload: any = {
      user_id: betaModal.userId,
      grant_type: "beta_tester",
      status: "active",
      granted_by: user?.id,
      notes: betaNotes.trim() || null,
      expires_at: betaExpires ? new Date(betaExpires).toISOString() : null,
    };

    const { error: grantError } = await supabase.from("user_access_grants").insert(payload);

    if (grantError) {
      setError(grantError.message);
    } else {
      showSuccess(`Acceso Beta otorgado a ${betaModal.name}.`);
      setBetaModal(null);
      setBetaNotes("");
      setBetaExpires("");
      await fetchUsers();
    }
    setBetaLoading(false);
  };

  const handleRevokeBeta = async (userId: string, grantId: string, name: string) => {
    setUpdatingId(userId);
    const { error: revokeError } = await supabase
      .from("user_access_grants")
      .update({ status: "revoked" })
      .eq("id", grantId);

    if (revokeError) {
      setError(revokeError.message);
    } else {
      showSuccess(`Acceso Beta revocado de ${name}.`);
      await fetchUsers();
    }
    setUpdatingId(null);
  };

  const handleMarkFounder = async (userId: string, name: string) => {
    setUpdatingId(userId);

    // Get next founder number
    const { data: lastFounder } = await supabase
      .from("founder_members")
      .select("founder_number")
      .order("founder_number", { ascending: false })
      .limit(1)
      .maybeSingle();

    const nextNumber = (lastFounder?.founder_number || 0) + 1;

    const { error: founderError } = await supabase.from("founder_members").insert({
      user_id: userId,
      founder_number: nextNumber,
      status: "active",
    });

    if (founderError) {
      setError(founderError.message);
    } else {
      showSuccess(`${name} marcado como Fundador #${nextNumber}.`);
      await fetchUsers();
    }
    setUpdatingId(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="bg-red-500/10 text-red-300 p-4 rounded-xl flex items-center gap-2 text-sm border border-red-500/30">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {successMsg && (
        <div className="bg-green-500/10 text-green-300 p-4 rounded-xl flex items-center gap-2 text-sm border border-green-500/30">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          {successMsg}
        </div>
      )}

      <div className="bg-[#111] border border-white/10 rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[#0a0a0a] border-b border-white/10 text-sm font-medium text-gray-500">
                <th className="px-4 py-3">Nombre</th>
                <th className="px-4 py-3">Estado</th>
                <th className="px-4 py-3">Rol</th>
                <th className="px-4 py-3">Membresía</th>
                <th className="px-4 py-3">Nivel</th>
                <th className="px-4 py-3">MP</th>
                <th className="px-4 py-3">Meses</th>
                <th className="px-4 py-3">Acceso Especial</th>
                <th className="px-4 py-3">Registro</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {users.map((user) => (
                <tr key={user.id} className="text-sm hover:bg-[#0a0a0a] transition-colors">
                  <td className="px-4 py-3 font-medium text-white">
                    <div>
                      {user.display_name || user.full_name || user.email || "Usuario sin nombre"}
                      {user.email && (user.display_name || user.full_name) && (
                        <p className="text-[11px] text-gray-500 mt-0.5">{user.email}</p>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-1">
                      {user.betaGrant && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-cyan-500/10 text-cyan-300 border border-cyan-500/30 w-fit">
                          <Shield size={9} /> Beta
                        </span>
                      )}
                      {user.founderData && (
                        <div className="flex flex-col gap-0.5">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/10 text-amber-300 border border-amber-500/30 w-fit">
                            <Star size={9} />
                            {user.founderData.status === 'active' ? 'Fundador' : 'Reservado'} #{user.founderData.founder_number}
                          </span>
                          {user.founderData.price_paid && (
                            <span className="text-[10px] text-amber-500/70 pl-0.5">${Number(user.founderData.price_paid).toLocaleString('es-AR')}</span>
                          )}
                          {user.founderData.confirmed_at && (
                            <span className="text-[10px] text-gray-600 pl-0.5">Confirmado {new Date(user.founderData.confirmed_at).toLocaleDateString('es-AR')}</span>
                          )}
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={user.role}
                      onChange={(e) => handleUpdate(user.id, "role", e.target.value)}
                      disabled={updatingId === user.id}
                      className="text-sm border-white/20 rounded-md focus:ring-orange-500 focus:border-orange-500 bg-[#111] shadow-sm disabled:opacity-50"
                    >
                      <option value="member">Member</option>
                      <option value="admin">Admin</option>
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={user.membership_status}
                      onChange={(e) => handleUpdate(user.id, "membership_status", e.target.value)}
                      disabled={updatingId === user.id}
                      className={`text-sm border-white/20 rounded-md focus:ring-orange-500 focus:border-orange-500 shadow-sm disabled:opacity-50 ${
                        user.membership_status === "active" ? "bg-green-500/10 text-green-300 font-medium" : "bg-[#111]"
                      }`}
                    >
                      <option value="active">Active</option>
                      <option value="inactive">Inactive</option>
                      <option value="cancelled">Cancelled</option>
                      <option value="expired">Expired</option>
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={user.member_level}
                      onChange={(e) => handleUpdate(user.id, "member_level", e.target.value)}
                      disabled={updatingId === user.id}
                      className="text-sm border-white/20 rounded-md focus:ring-orange-500 focus:border-orange-500 bg-[#111] shadow-sm disabled:opacity-50"
                    >
                      <option value="bronze">Bronze</option>
                      <option value="silver">Silver</option>
                      <option value="gold">Gold</option>
                      <option value="elite">Elite</option>
                    </select>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {user.subscriptions && user.subscriptions.length > 0 ? (
                      <span className={`px-2 py-1 rounded-full font-semibold ${
                        user.subscriptions[0].status === "authorized" || user.subscriptions[0].status === "active"
                          ? "bg-green-500/10 text-green-300"
                          : user.subscriptions[0].status === "cancelled"
                            ? "bg-red-500/10 text-red-300"
                            : "bg-white/5 text-gray-300"
                      }`}>
                        {user.subscriptions[0].status}
                      </span>
                    ) : (
                      <span className="text-gray-500 italic">No</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <input
                      type="number"
                      min="0"
                      value={user.active_months}
                      onChange={(e) => handleUpdate(user.id, "active_months", parseInt(e.target.value) || 0)}
                      disabled={updatingId === user.id}
                      className="w-16 text-sm border-white/20 rounded-md focus:ring-orange-500 focus:border-orange-500 bg-[#111] shadow-sm disabled:opacity-50"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1.5">
                      {user.betaGrant ? (
                        <button
                          onClick={() => handleRevokeBeta(user.id, user.betaGrant.id, user.display_name || user.full_name || user.email)}
                          disabled={updatingId === user.id}
                          className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold bg-red-500/10 text-red-300 border border-red-500/30 hover:bg-red-500/20 transition-colors disabled:opacity-50"
                        >
                          <ShieldOff size={9} /> Revocar Beta
                        </button>
                      ) : (
                        <button
                          onClick={() => setBetaModal({
                            userId: user.id,
                            name: user.display_name || user.full_name || user.email || "Usuario",
                          })}
                          disabled={updatingId === user.id}
                          className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold bg-cyan-500/10 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-500/20 transition-colors disabled:opacity-50"
                        >
                          <Shield size={9} /> Dar Beta
                        </button>
                      )}
                      {!user.founderData && (
                        <button
                          onClick={() => handleMarkFounder(user.id, user.display_name || user.full_name || user.email || "Usuario")}
                          disabled={updatingId === user.id}
                          title="Override manual. El flujo normal es automático al pagar."
                          className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold bg-white/5 text-gray-500 border border-white/10 hover:bg-amber-500/10 hover:text-amber-400 hover:border-amber-500/30 transition-colors disabled:opacity-50"
                        >
                          <Star size={9} /> Override Fundador
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">
                    {new Intl.DateTimeFormat("es-AR", { dateStyle: "medium" }).format(new Date(user.created_at))}
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-gray-500">No se encontraron usuarios.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Beta Grant Modal */}
      {betaModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-[#111] border border-white/10 rounded-2xl shadow-2xl p-6 w-full max-w-md mx-4">
            <h3 className="text-lg font-bold text-white mb-1 flex items-center gap-2">
              <Shield size={16} className="text-cyan-400" />
              Dar acceso Beta
            </h3>
            <p className="text-sm text-gray-400 mb-5">Para: <span className="font-semibold text-white">{betaModal.name}</span></p>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
                  Fecha de vencimiento <span className="text-gray-600 font-normal normal-case">(opcional)</span>
                </label>
                <input
                  type="date"
                  value={betaExpires}
                  onChange={(e) => setBetaExpires(e.target.value)}
                  className="w-full rounded-xl border border-white/10 px-3 py-2.5 text-sm text-white bg-white/5 focus:outline-none focus:border-orange-500/50"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
                  Notas <span className="text-gray-600 font-normal normal-case">(opcional)</span>
                </label>
                <textarea
                  value={betaNotes}
                  onChange={(e) => setBetaNotes(e.target.value)}
                  rows={2}
                  placeholder="Ej. Acceso para testear módulo de sorteos..."
                  className="w-full rounded-xl border border-white/10 px-3 py-2.5 text-sm text-white bg-white/5 focus:outline-none focus:border-orange-500/50 resize-none"
                />
              </div>
            </div>

            <div className="flex gap-2 mt-6">
              <button
                onClick={() => { setBetaModal(null); setBetaNotes(""); setBetaExpires(""); }}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold text-gray-400 bg-white/5 border border-white/10 hover:bg-white/10 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleGrantBeta}
                disabled={betaLoading}
                className="flex-1 flex justify-center items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white bg-cyan-600 hover:bg-cyan-500 transition-colors disabled:opacity-60"
              >
                {betaLoading ? <Loader2 size={14} className="animate-spin" /> : <Shield size={14} />}
                Dar acceso Beta
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
