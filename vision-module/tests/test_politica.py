# Pruebas de app.mapping.politica: la tabla completa de qué escribe el módulo
# según lo que ve y cómo está la mesa. Es la regla de negocio del ticket, así
# que se cubre caso por caso y no por muestreo.

from datetime import datetime, timedelta, timezone

import pytest

from app.mapping.politica import (
    CONFIRMAR,
    LIBRE,
    OCUPADA,
    PENDIENTE_LIMPIEZA,
    RESERVADA,
    estado_objetivo,
)


class TestHayGente:
    def test_libre_pasa_a_ocupada(self):
        assert estado_objetivo(hay_gente=True, estado_actual=LIBRE) == OCUPADA

    def test_reservada_pasa_a_ocupada(self):
        # Llegó quien había reservado.
        assert estado_objetivo(hay_gente=True, estado_actual=RESERVADA) == OCUPADA

    def test_ocupada_no_se_toca(self):
        assert estado_objetivo(hay_gente=True, estado_actual=OCUPADA) is None

    def test_pendiente_limpieza_no_se_toca(self):
        # Lo más probable es que sea el personal limpiando: marcarla ocupada
        # borraría la tarea abierta.
        assert estado_objetivo(hay_gente=True, estado_actual=PENDIENTE_LIMPIEZA) is None


class TestMesaVacia:
    def test_ocupada_pasa_a_pendiente_limpieza(self):
        assert estado_objetivo(hay_gente=False, estado_actual=OCUPADA) == PENDIENTE_LIMPIEZA

    def test_libre_no_se_toca(self):
        assert estado_objetivo(hay_gente=False, estado_actual=LIBRE) is None

    def test_reservada_no_se_toca(self):
        # La reserva la gestiona recepción: una mesa reservada está vacía a propósito.
        assert estado_objetivo(hay_gente=False, estado_actual=RESERVADA) is None

    def test_pendiente_limpieza_no_se_toca(self):
        # La libera el personal con PATCH /mesas/{id}/limpieza.
        assert estado_objetivo(hay_gente=False, estado_actual=PENDIENTE_LIMPIEZA) is None


class TestReservaConHora:
    """La reserva con hora (T26-208).

    La regla: cerca de la hora reservada son ellos y se ocupa sola; lejos es dudoso y lo
    resuelve una persona. Lo que se cubre acá es dónde está el corte, porque el valor de
    la ventana es justamente lo que decide cuántas veces se molesta a alguien.
    """

    HORA = datetime(2026, 9, 29, 21, 0, tzinfo=timezone.utc)
    TOLERANCIA = 30

    def _objetivo(self, minutos_de_desfase):
        return estado_objetivo(
            hay_gente=True,
            estado_actual=RESERVADA,
            reservada_para=self.HORA,
            ahora=self.HORA + timedelta(minutes=minutos_de_desfase),
            tolerancia_minutos=self.TOLERANCIA,
        )

    def test_puntual_se_ocupa_sola(self):
        assert self._objetivo(0) == OCUPADA

    @pytest.mark.parametrize("desfase", [-29, -1, 1, 29])
    def test_dentro_de_la_ventana_se_ocupa_sola(self, desfase):
        # Llegar un rato antes o demorarse un rato es lo normal de una reserva.
        assert self._objetivo(desfase) == OCUPADA

    @pytest.mark.parametrize("desfase", [-30, 30])
    def test_el_borde_exacto_todavia_entra(self, desfase):
        # El corte es inclusivo: a los 30 justos sigue siendo válido.
        assert self._objetivo(desfase) == OCUPADA

    @pytest.mark.parametrize("desfase", [-120, -31, 31, 120])
    def test_fuera_de_la_ventana_pide_confirmacion(self, desfase):
        # Sentarse una hora antes no es llegar temprano: probablemente sea alguien que
        # no vio que la mesa estaba reservada.
        assert self._objetivo(desfase) == CONFIRMAR

    def test_sin_hora_se_comporta_como_antes(self):
        # Una reserva sin hora no se puede juzgar, y negarse a ocupar la mesa por un dato
        # que el sistema no pedía hasta ayer sería peor que el supuesto viejo.
        assert estado_objetivo(hay_gente=True, estado_actual=RESERVADA) == OCUPADA

    def test_una_hora_ingenua_no_revienta(self):
        # El backend manda la hora con zona, pero si alguna vez llega sin ella la resta
        # estallaría con un TypeError en pleno ciclo.
        assert estado_objetivo(
            hay_gente=True,
            estado_actual=RESERVADA,
            reservada_para=datetime(2026, 9, 29, 21, 0),
            ahora=self.HORA,
            tolerancia_minutos=self.TOLERANCIA,
        ) == OCUPADA

    def test_la_mesa_vacia_sigue_sin_tocarse(self):
        # La ventana solo interviene cuando hay gente: una mesa reservada y vacía está
        # así a propósito, con hora o sin ella.
        assert estado_objetivo(
            hay_gente=False,
            estado_actual=RESERVADA,
            reservada_para=self.HORA,
            ahora=self.HORA,
            tolerancia_minutos=self.TOLERANCIA,
        ) is None


class TestInvariantes:
    @pytest.mark.parametrize("estado", [LIBRE, OCUPADA, PENDIENTE_LIMPIEZA, RESERVADA])
    @pytest.mark.parametrize("hay_gente", [True, False])
    def test_el_modulo_nunca_escribe_libre(self, estado, hay_gente):
        # Una mesa vuelve a estar libre cuando alguien la limpia, no cuando se vacía.
        assert estado_objetivo(hay_gente, estado) != LIBRE

    @pytest.mark.parametrize("estado", [LIBRE, OCUPADA, PENDIENTE_LIMPIEZA, RESERVADA])
    @pytest.mark.parametrize("hay_gente", [True, False])
    def test_nunca_escribe_el_estado_que_ya_tiene(self, estado, hay_gente):
        # Un PATCH redundante ensuciaría el historial con una fila por frame.
        assert estado_objetivo(hay_gente, estado) != estado

    def test_un_estado_desconocido_no_se_toca(self):
        # El backend podría sumar un estado nuevo: mejor ignorarlo que pisarlo.
        assert estado_objetivo(hay_gente=True, estado_actual="fuera_de_servicio") is None
