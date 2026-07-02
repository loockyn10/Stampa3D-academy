import React from 'react'
import Link from 'next/link'
import { Users, Settings, ShieldAlert } from 'lucide-react'

export default function AdminDashboardPage() {
  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <ShieldAlert className="text-blue-600" />
          Panel de Administración
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Gestiona los usuarios, permisos y configuraciones de la academia.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Link href="/admin/usuarios" className="block">
          <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow cursor-pointer">
            <div className="flex items-center gap-4 mb-4">
              <div className="p-3 bg-blue-50 text-blue-600 rounded-lg">
                <Users size={24} />
              </div>
              <h2 className="text-lg font-semibold text-gray-900">Usuarios</h2>
            </div>
            <p className="text-sm text-gray-600">
              Administra los roles, estado de membresías y niveles de todos los usuarios registrados.
            </p>
          </div>
        </Link>
        
        {/* Placeholder for future admin modules */}
        <div className="bg-white/50 p-6 rounded-xl border border-gray-200 border-dashed opacity-60">
            <div className="flex items-center gap-4 mb-4">
              <div className="p-3 bg-gray-100 text-gray-400 rounded-lg">
                <Settings size={24} />
              </div>
              <h2 className="text-lg font-semibold text-gray-500">Configuración (Próximamente)</h2>
            </div>
            <p className="text-sm text-gray-400">
              Módulos futuros de administración.
            </p>
        </div>
      </div>
    </div>
  )
}
