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
        <Link href="/admin/cursos" className="block">
          <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow cursor-pointer h-full">
            <div className="flex items-center gap-4 mb-4">
              <div className="p-3 bg-orange-50 text-orange-600 rounded-lg">
                <Settings size={24} /> {/* Assuming we'll use a generic icon, or BookOpen if imported */}
              </div>
              <h2 className="text-lg font-semibold text-gray-900">Cursos</h2>
            </div>
            <p className="text-sm text-gray-600">
              Administra los cursos, módulos y clases disponibles en la plataforma.
            </p>
          </div>
        </Link>
        
        <Link href="/admin/cursos/configuracion" className="block">
          <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow cursor-pointer h-full">
            <div className="flex items-center gap-4 mb-4">
              <div className="p-3 bg-purple-50 text-purple-600 rounded-lg">
                <Settings size={24} />
              </div>
              <h2 className="text-lg font-semibold text-gray-900">Categorías e Instructores</h2>
            </div>
            <p className="text-sm text-gray-600">
              Configura los metadatos necesarios para los cursos.
            </p>
          </div>
        </Link>
      </div>
    </div>
  )
}
