"use client";

import React, { useEffect, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { Loader2, CheckCircle2, AlertCircle } from "lucide-react";

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
};

export function UsersTable() {
  const [users, setUsers] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  
  const supabase = createClient();

  const fetchUsers = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setError("No has iniciado sesión.");
        setLoading(false);
        return;
      }

      const { data: currentUserProfile, error: profileError } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single();

      if (profileError) {
        console.error("Error verificando permisos:", profileError);
        setError(`Error de permisos: ${profileError.message}`);
        setLoading(false);
        return;
      }

      if (currentUserProfile?.role !== "admin") {
        setError("Acceso denegado: Se requiere rol de administrador.");
        setLoading(false);
        return;
      }

      const { data: profilesData, error: fetchError } = await supabase
        .from("profiles")
        .select("*")
        .order("created_at", { ascending: false });

      if (fetchError) {
        console.error("Error cargando perfiles:", fetchError);
        setError(fetchError.message);
        setLoading(false);
        return;
      }

      // 2. Query subscriptions separately
      const userIds = (profilesData || []).map((p) => p.id);
      let subscriptionsData: any[] = [];
      if (userIds.length > 0) {
        const { data: subs, error: subsError } = await supabase
          .from("subscriptions")
          .select("*")
          .in("user_id", userIds)
          .order("created_at", { ascending: false });

        if (subsError) {
          console.error("Error loading subscriptions:", subsError);
          // Do not fail the whole page load if subscriptions fail
        } else {
          subscriptionsData = subs || [];
        }
      }

      // 3. Map subscriptions back to profiles
      const usersWithSubs = (profilesData || []).map((profile) => {
        const userSubs = subscriptionsData.filter((sub) => sub.user_id === profile.id);
        return {
          ...profile,
          subscriptions: userSubs,
        };
      });

      setUsers(usersWithSubs as Profile[]);
    } catch (err: any) {
      console.error("Excepción inesperada:", err);
      setError(err.message || "Error inesperado al cargar usuarios");
    }
    
    setLoading(false);
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleUpdate = async (id: string, field: keyof Profile, value: any) => {
    setUpdatingId(id);
    setError(null);
    setSuccessMsg(null);

    const { error: updateError } = await supabase
      .from("profiles")
      .update({ [field]: value })
      .eq("id", id);

    if (updateError) {
      setError(updateError.message);
    } else {
      setUsers((prev) =>
        prev.map((user) => (user.id === id ? { ...user, [field]: value } : user))
      );
      setSuccessMsg("Usuario actualizado correctamente.");
      setTimeout(() => setSuccessMsg(null), 3000);
    }
    setUpdatingId(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="bg-red-50 text-red-600 p-4 rounded-lg flex items-center gap-2 text-sm border border-red-100">
          <AlertCircle className="h-4 w-4" />
          {error}
        </div>
      )}
      
      {successMsg && (
        <div className="bg-green-50 text-green-700 p-4 rounded-lg flex items-center gap-2 text-sm border border-green-100">
          <CheckCircle2 className="h-4 w-4" />
          {successMsg}
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-sm font-medium text-gray-500">
                <th className="px-4 py-3">Nombre</th>
                <th className="px-4 py-3">Rol</th>
                <th className="px-4 py-3">Estado Membresía</th>
                <th className="px-4 py-3">Nivel</th>
                <th className="px-4 py-3">Suscripción MP</th>
                <th className="px-4 py-3">Meses Activos</th>
                <th className="px-4 py-3">Fecha de Registro</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {users.map((user) => (
                <tr key={user.id} className="text-sm hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 font-medium text-gray-900">
                    {user.display_name || user.full_name || user.email || "Usuario sin nombre"}
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={user.role}
                      onChange={(e) => handleUpdate(user.id, "role", e.target.value)}
                      disabled={updatingId === user.id}
                      className="text-sm border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 bg-white shadow-sm disabled:opacity-50"
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
                      className={`text-sm border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 shadow-sm disabled:opacity-50 ${
                        user.membership_status === "active" ? "bg-green-50 text-green-700 font-medium" : "bg-white"
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
                      className="text-sm border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 bg-white shadow-sm disabled:opacity-50"
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
                        user.subscriptions[0].status === "authorized" || user.subscriptions[0].status === "active" ? "bg-green-100 text-green-700" :
                        user.subscriptions[0].status === "cancelled" ? "bg-red-100 text-red-700" :
                        "bg-gray-100 text-gray-700"
                      }`}>
                        {user.subscriptions[0].status}
                      </span>
                    ) : (
                      <span className="text-gray-400 italic">No</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <input
                      type="number"
                      min="0"
                      value={user.active_months}
                      onChange={(e) => handleUpdate(user.id, "active_months", parseInt(e.target.value) || 0)}
                      disabled={updatingId === user.id}
                      className="w-20 text-sm border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 shadow-sm disabled:opacity-50"
                    />
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {new Intl.DateTimeFormat("es-AR", {
                      dateStyle: "medium",
                    }).format(new Date(user.created_at))}
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                    No se encontraron usuarios.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
