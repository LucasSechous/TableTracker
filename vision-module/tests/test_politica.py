# Pruebas de app.mapping.politica: la tabla completa de qué escribe el módulo
# según lo que ve y cómo está la mesa. Es la regla de negocio del ticket, así
# que se cubre caso por caso y no por muestreo.

import pytest

from app.mapping.politica import (
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
