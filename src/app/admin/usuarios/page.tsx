import React from "react";
import { UsersTable } from "@/components/admin/users-table";
import { Users } from "lucide-react";
import Link from "next/link";

export default function AdminUsuariosPage() {
  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Link href="/admin" className="text-sm font-medium text-blue-600 hover:text-blue-500">
            Admin
          </Link>
          <span className="text-gray-400">/</span>
          <span className="text-sm text-gray-500">Usuarios</span>
        </div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Users className="text-blue-600" />
          Gestión de Usuarios
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Actualiza el estado de las membresías, niveles y roles de los usuarios registrados.
        </p>
      </div>

      <UsersTable />
    </div>
  );
}
