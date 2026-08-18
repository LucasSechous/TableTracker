# Pruebas de app.mapping.confirmacion: el umbral de tiempo sostenido que separa
# una observación puntual de un cambio de estado confirmado.
# El reloj se pasa como argumento, así que no hace falta esperar de verdad.

from app.mapping.confirmacion import Confirmador

UMBRAL = 6.0


class TestConfirmacion:
    def test_la_primera_lectura_no_confirma_nada(self):
        confirmador = Confirmador(UMBRAL)
        assert confirmador.actualizar({1: True}, ahora=0.0) == {}

    def test_no_confirma_antes_del_umbral(self):
        confirmador = Confirmador(UMBRAL)
        confirmador.actualizar({1: True}, ahora=0.0)
        assert confirmador.actualizar({1: True}, ahora=5.9) == {}

    def test_confirma_al_sostenerse_el_umbral(self):
        confirmador = Confirmador(UMBRAL)
        confirmador.actualizar({1: True}, ahora=0.0)
        assert confirmador.actualizar({1: True}, ahora=6.0) == {1: True}

    def test_no_repite_un_cambio_ya_confirmado(self):
        confirmador = Confirmador(UMBRAL)
        confirmador.actualizar({1: True}, ahora=0.0)
        confirmador.actualizar({1: True}, ahora=6.0)
        assert confirmador.actualizar({1: True}, ahora=20.0) == {}

    def test_una_observacion_que_se_corta_reinicia_el_reloj(self):
        # Alguien pasa caminando: se lo ve 4 segundos, desaparece y vuelve.
        # No tiene que confirmarse a los 6 segundos del primer avistamiento.
        confirmador = Confirmador(UMBRAL)
        confirmador.actualizar({1: True}, ahora=0.0)
        confirmador.actualizar({1: False}, ahora=4.0)
        confirmador.actualizar({1: True}, ahora=5.0)
        assert confirmador.actualizar({1: True}, ahora=10.0) == {}
        assert confirmador.actualizar({1: True}, ahora=11.0) == {1: True}

    def test_confirma_el_paso_de_ocupada_a_vacia(self):
        confirmador = Confirmador(UMBRAL)
        confirmador.actualizar({1: True}, ahora=0.0)
        confirmador.actualizar({1: True}, ahora=6.0)
        confirmador.actualizar({1: False}, ahora=10.0)
        assert confirmador.actualizar({1: False}, ahora=16.0) == {1: False}

    def test_cada_mesa_lleva_su_propio_reloj(self):
        confirmador = Confirmador(UMBRAL)
        confirmador.actualizar({1: True, 2: False}, ahora=0.0)
        confirmador.actualizar({1: True, 2: True}, ahora=3.0)
        # La mesa 1 lleva 6s sostenidos; la 2 recién 3s desde que cambió.
        assert confirmador.actualizar({1: True, 2: True}, ahora=6.0) == {1: True}

    def test_una_mesa_que_arranca_vacia_tambien_se_confirma(self):
        # No se supone ningún estado inicial: la primera lectura sostenida se
        # confirma igual, y es la política la que decide si eso cambia algo.
        confirmador = Confirmador(UMBRAL)
        confirmador.actualizar({1: False}, ahora=0.0)
        assert confirmador.actualizar({1: False}, ahora=6.0) == {1: False}


class TestRevertir:
    def test_revertir_hace_que_se_vuelva_a_confirmar(self):
        # El cambio se confirmó pero el backend no lo aceptó: la observación
        # sigue sostenida, así que el próximo frame lo reintenta.
        confirmador = Confirmador(UMBRAL)
        confirmador.actualizar({1: True}, ahora=0.0)
        assert confirmador.actualizar({1: True}, ahora=6.0) == {1: True}

        confirmador.revertir(1)
        assert confirmador.actualizar({1: True}, ahora=8.0) == {1: True}

    def test_revertir_una_mesa_desconocida_no_falla(self):
        Confirmador(UMBRAL).revertir(99)


class TestOlvidar:
    def test_olvida_las_mesas_que_ya_no_estan(self):
        confirmador = Confirmador(UMBRAL)
        confirmador.actualizar({1: True, 2: True}, ahora=0.0)
        confirmador.actualizar({1: True, 2: True}, ahora=6.0)

        confirmador.olvidar([1])

        # La mesa 2 vuelve a arrancar de cero: su confirmación se emite de nuevo.
        confirmador.actualizar({1: True, 2: True}, ahora=10.0)
        assert confirmador.actualizar({1: True, 2: True}, ahora=16.0) == {2: True}
