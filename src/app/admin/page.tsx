import React from 'react'
import Link from 'next/link'
import { Users, Settings, ShieldAlert, GraduationCap, Boxes, Gift, Trophy, MonitorSmartphone, DollarSign, Map } from 'lucide-react'
import { SectionTitle } from "@/components/ui/section-title";

export default function AdminDashboardPage() {
  return (
    <div className="space-y-8 pb-12">
      <SectionTitle eyebrow="Gestión" title="Panel Admin" />
      <p className="text-sm text-gray-400 -mt-3 mb-6">
        Gestioná usuarios, cursos, archivos STL, sorteos y contenido de Academia Stampa.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        <Link href="/admin/usuarios" className="block group">
          <div className="bg-[#111] p-6 rounded-2xl border border-white/10 shadow-lg shadow-black/20 hover:border-orange-500/30 transition-all h-full relative overflow-hidden">
            <div className="absolute top-0 right-0 w-24 h-24 bg-blue-500/5 rounded-full blur-2xl group-hover:bg-blue-500/10 transition-colors -translate-y-1/2 translate-x-1/2"></div>
            <div className="flex items-center gap-4 mb-4 relative z-10">
              <div className="p-3 bg-[#0a0a0a] border border-white/5 text-blue-500 rounded-xl shadow-inner">
                <Users size={24} />
              </div>
              <h2 className="text-lg font-bold text-white group-hover:text-blue-400 transition-colors">Usuarios</h2>
            </div>
            <p className="text-sm text-gray-400 font-medium relative z-10">
              Gestioná miembros, roles, insignias y estados de membresía de toda la comunidad.
            </p>
          </div>
        </Link>
        
        <Link href="/admin/cursos" className="block group">
          <div className="bg-[#111] p-6 rounded-2xl border border-white/10 shadow-lg shadow-black/20 hover:border-orange-500/30 transition-all h-full relative overflow-hidden">
            <div className="absolute top-0 right-0 w-24 h-24 bg-orange-500/5 rounded-full blur-2xl group-hover:bg-orange-500/10 transition-colors -translate-y-1/2 translate-x-1/2"></div>
            <div className="flex items-center gap-4 mb-4 relative z-10">
              <div className="p-3 bg-[#0a0a0a] border border-white/5 text-orange-500 rounded-xl shadow-inner">
                <GraduationCap size={24} />
              </div>
              <h2 className="text-lg font-bold text-white group-hover:text-orange-400 transition-colors">Cursos</h2>
            </div>
            <p className="text-sm text-gray-400 font-medium relative z-10">
              Creá cursos, módulos, clases, recursos y ajustá los metadatos educativos.
            </p>
          </div>
        </Link>
        
        <Link href="/admin/stl" className="block group">
          <div className="bg-[#111] p-6 rounded-2xl border border-white/10 shadow-lg shadow-black/20 hover:border-orange-500/30 transition-all h-full relative overflow-hidden">
            <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-500/5 rounded-full blur-2xl group-hover:bg-emerald-500/10 transition-colors -translate-y-1/2 translate-x-1/2"></div>
            <div className="flex items-center gap-4 mb-4 relative z-10">
              <div className="p-3 bg-[#0a0a0a] border border-white/5 text-emerald-500 rounded-xl shadow-inner">
                <Boxes size={24} />
              </div>
              <h2 className="text-lg font-bold text-white group-hover:text-emerald-400 transition-colors">Librería STL</h2>
            </div>
            <p className="text-sm text-gray-400 font-medium relative z-10">
              Administrá categorías y archivos 3D descargables para los usuarios.
            </p>
          </div>
        </Link>

        <Link href="/admin/sorteos" className="block group">
          <div className="bg-[#111] p-6 rounded-2xl border border-white/10 shadow-lg shadow-black/20 hover:border-orange-500/30 transition-all h-full relative overflow-hidden">
            <div className="absolute top-0 right-0 w-24 h-24 bg-indigo-500/5 rounded-full blur-2xl group-hover:bg-indigo-500/10 transition-colors -translate-y-1/2 translate-x-1/2"></div>
            <div className="flex items-center gap-4 mb-4 relative z-10">
              <div className="p-3 bg-[#0a0a0a] border border-white/5 text-indigo-500 rounded-xl shadow-inner">
                <Gift size={24} />
              </div>
              <h2 className="text-lg font-bold text-white group-hover:text-indigo-400 transition-colors">Sorteos</h2>
            </div>
            <p className="text-sm text-gray-400 font-medium relative z-10">
              Creá sorteos exclusivos para miembros, configurá premios y elegí ganadores.
            </p>
          </div>
        </Link>

        <Link href="/admin/insignias" className="block group">
          <div className="bg-[#111] p-6 rounded-2xl border border-white/10 shadow-lg shadow-black/20 hover:border-orange-500/30 transition-all h-full relative overflow-hidden">
            <div className="absolute top-0 right-0 w-24 h-24 bg-amber-500/5 rounded-full blur-2xl group-hover:bg-amber-500/10 transition-colors -translate-y-1/2 translate-x-1/2"></div>
            <div className="flex items-center gap-4 mb-4 relative z-10">
              <div className="p-3 bg-[#0a0a0a] border border-white/5 text-amber-500 rounded-xl shadow-inner">
                <Trophy size={24} />
              </div>
              <h2 className="text-lg font-bold text-white group-hover:text-amber-400 transition-colors">Insignias</h2>
            </div>
            <p className="text-sm text-gray-400 font-medium relative z-10">
              Gestioná reconocimientos y badges para la gamificación de la comunidad.
            </p>
          </div>
        </Link>
        
        <Link href="/admin/cursos/configuracion" className="block group">
          <div className="bg-[#111] p-6 rounded-2xl border border-white/10 shadow-lg shadow-black/20 hover:border-orange-500/30 transition-all h-full relative overflow-hidden">
            <div className="absolute top-0 right-0 w-24 h-24 bg-purple-500/5 rounded-full blur-2xl group-hover:bg-purple-500/10 transition-colors -translate-y-1/2 translate-x-1/2"></div>
            <div className="flex items-center gap-4 mb-4 relative z-10">
              <div className="p-3 bg-[#0a0a0a] border border-white/5 text-purple-500 rounded-xl shadow-inner">
                <Settings size={24} />
              </div>
              <h2 className="text-lg font-bold text-white group-hover:text-purple-400 transition-colors">Config. Educativa</h2>
            </div>
            <p className="text-sm text-gray-400 font-medium relative z-10">
              Administrá categorías, instructores y datos auxiliares de los cursos.
            </p>
          </div>
        </Link>
        
        <Link href="/admin/impresoras" className="block group">
          <div className="bg-[#111] p-6 rounded-2xl border border-white/10 shadow-lg shadow-black/20 hover:border-orange-500/30 transition-all h-full relative overflow-hidden">
            <div className="absolute top-0 right-0 w-24 h-24 bg-teal-500/5 rounded-full blur-2xl group-hover:bg-teal-500/10 transition-colors -translate-y-1/2 translate-x-1/2"></div>
            <div className="flex items-center gap-4 mb-4 relative z-10">
              <div className="p-3 bg-[#0a0a0a] border border-white/5 text-teal-500 rounded-xl shadow-inner">
                <MonitorSmartphone size={24} />
              </div>
              <h2 className="text-lg font-bold text-white group-hover:text-teal-400 transition-colors">Catálogo de Impresoras</h2>
            </div>
            <p className="text-sm text-gray-400 font-medium relative z-10">
              Plantillas globales que los usuarios pueden importar a sus talleres.
            </p>
          </div>
        </Link>
        
        <Link href="/admin/membresia" className="block group">
          <div className="bg-[#111] p-6 rounded-2xl border border-white/10 shadow-lg shadow-black/20 hover:border-orange-500/30 transition-all h-full relative overflow-hidden">
            <div className="absolute top-0 right-0 w-24 h-24 bg-red-500/5 rounded-full blur-2xl group-hover:bg-red-500/10 transition-colors -translate-y-1/2 translate-x-1/2"></div>
            <div className="flex items-center gap-4 mb-4 relative z-10">
              <div className="p-3 bg-[#0a0a0a] border border-white/5 text-red-500 rounded-xl shadow-inner">
                <DollarSign size={24} />
              </div>
              <h2 className="text-lg font-bold text-white group-hover:text-red-400 transition-colors">Cobros y Membresía</h2>
            </div>
            <p className="text-sm text-gray-400 font-medium relative z-10">
              Configurá precios y forzá actualizaciones de suscripciones.
            </p>
          </div>
        </Link>
        <Link href="/admin/roadmaps" className="block group">
          <div className="bg-[#111] p-6 rounded-2xl border border-white/10 shadow-lg shadow-black/20 hover:border-orange-500/30 transition-all h-full relative overflow-hidden">
            <div className="absolute top-0 right-0 w-24 h-24 bg-pink-500/5 rounded-full blur-2xl group-hover:bg-pink-500/10 transition-colors -translate-y-1/2 translate-x-1/2"></div>
            <div className="flex items-center gap-4 mb-4 relative z-10">
              <div className="p-3 bg-[#0a0a0a] border border-white/5 text-pink-500 rounded-xl shadow-inner">
                <Map size={24} />
              </div>
              <h2 className="text-lg font-bold text-white group-hover:text-pink-400 transition-colors">Roadmaps</h2>
            </div>
            <p className="text-sm text-gray-400 font-medium relative z-10">
              Configurá rutas recomendadas según impresora, nivel y objetivo.
            </p>
          </div>
        </Link>
      </div>
    </div>
  )
}
