// Aviso de que hay gente sentada en una mesa reservada (T26-208).
//
// De dónde sale: hasta ahora el módulo de visión mandaba `reservada + hay gente -> ocupada`
// dando por hecho que era quien había reservado. Ese supuesto falla cuando alguien se
// sienta sin ver que la mesa está tomada, y marcarla ocupada borra la reserva de la
// pantalla justo antes de que lleguen los que sí reservaron.
//
// Ahora, cuando la detección cae lejos de la hora reservada, el módulo no toca la mesa y
// deja esta marca. La decisión la toma una persona desde acá.
//
// Por qué no es un modal: un modal bloquea la pantalla, y esto llega solo, sin que nadie
// lo haya pedido, mientras alguien está haciendo otra cosa en el salón. Un cartel arriba
// del canvas se ve igual de bien y no secuestra la aplicación. Tampoco se cierra solo: si
// desapareciera a los pocos segundos, la mesa quedaría esperando sin que nadie se entere.

import type { Mesa } from "../types"
import { horaDeLaReserva } from "../constants"
import Boton from "./ui/Boton"

interface Props {
  mesas: Mesa[]
  /** Confirma que sí corresponde ocuparla. */
  onConfirmar: (mesa: Mesa) => void
  /** No eran los de la reserva: se descarta el aviso y la mesa sigue reservada. */
  onDescartar: (mesa: Mesa) => void
  ocupado: boolean
}

export default function AvisoReservaDetectada({ mesas, onConfirmar, onDescartar, ocupado }: Props) {
  if (mesas.length === 0) return null

  return (
    <div
      data-testid="aviso-reserva-detectada"
      // role=alert y no status: esto exige una decisión de una persona, así que corresponde
      // que un lector de pantalla lo interrumpa en vez de esperar a que termine la frase.
      role="alert"
      className="flex flex-col gap-[10px] mb-[16px] py-[12px] px-[16px] rounded-[8px] bg-aviso-fuerte-fondo border border-aviso-fuerte-borde"
    >
      <span className="text-[14px] font-semibold text-aviso-fuerte">
        {mesas.length === 1
          ? "Hay gente en una mesa reservada"
          : `Hay gente en ${mesas.length} mesas reservadas`}
      </span>

      {mesas.map((mesa) => {
        const hora = horaDeLaReserva(mesa.reservada_para)
        return (
          <div
            key={mesa.id}
            data-testid={`aviso-reserva-mesa-${mesa.numero}`}
            className="flex items-center gap-[10px] flex-wrap"
          >
            <span className="text-[13px] text-slate-700 flex-[1_1_260px]">
              {/* Se nombra la mesa y la hora porque son los dos datos con los que se decide:
                  cuál es, y si la hora hace plausible que sean los de la reserva. */}
              Mesa {mesa.numero}
              {hora ? ` — reservada para las ${hora}` : " — reservada"}
            </span>
            <Boton
              variante="primario"
              data-testid={`aviso-reserva-confirmar-${mesa.numero}`}
              disabled={ocupado}
              onClick={() => onConfirmar(mesa)}
            >
              Sí, ocupar
            </Boton>
            <Boton
              variante="neutro"
              data-testid={`aviso-reserva-descartar-${mesa.numero}`}
              disabled={ocupado}
              onClick={() => onDescartar(mesa)}
            >
              No son ellos
            </Boton>
          </div>
        )
      })}
    </div>
  )
}
