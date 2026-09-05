# Franja horaria de servicio (T26-171).
#
# El caso que justifica estos tests es el local que cierra después de medianoche
# (apertura 20:00, cierre 02:00): ahí la franja NO es el intervalo [apertura, cierre]
# sino su complemento, y una comparación ingenua da un rango vacío que hace que la
# rotación cuente cero sin que nada falle a la vista.

from datetime import datetime, time, timedelta, timezone

import pytest

from app.services.horario import TZ_LOCAL, en_horario_de_servicio, hora_local


def utc(anio, mes, dia, hora, minuto=0):
    return datetime(anio, mes, dia, hora, minuto, tzinfo=timezone.utc)


def local(anio, mes, dia, hora, minuto=0):
    """Un instante expresado en la hora del reloj del local."""
    return datetime(anio, mes, dia, hora, minuto, tzinfo=TZ_LOCAL)


class TestSinHorarioCargado:
    """Sin horario, el comportamiento tiene que ser exactamente el de antes del ticket."""

    @pytest.mark.parametrize("hora", [0, 4, 12, 23])
    def test_sin_ninguna_hora_cuenta_las_24_horas(self, hora):
        assert en_horario_de_servicio(local(2026, 9, 5, hora), None, None) is True

    def test_con_una_sola_hora_cargada_tambien_cuenta_todo(self):
        # Media configuración no define una franja: hasta que estén las dos, no se recorta.
        assert en_horario_de_servicio(local(2026, 9, 5, 4), time(20, 0), None) is True
        assert en_horario_de_servicio(local(2026, 9, 5, 4), None, time(2, 0)) is True


class TestFranjaDentroDelMismoDia:
    """Local diurno: 12:00 a 23:00."""

    APERTURA = time(12, 0)
    CIERRE = time(23, 0)

    @pytest.mark.parametrize("hora,esperado", [
        (11, False),   # antes de abrir
        (12, True),    # justo al abrir
        (18, True),    # pleno servicio
        (23, True),    # justo al cerrar
        (23.5, False), # después de cerrar (23:30)
        (4, False),    # madrugada
    ])
    def test_franja(self, hora, esperado):
        h = int(hora)
        m = 30 if hora != h else 0
        momento = local(2026, 9, 5, h, m)
        assert en_horario_de_servicio(momento, self.APERTURA, self.CIERRE) is esperado


class TestFranjaQueCruzaMedianoche:
    """El caso típico de un restaurante: abre 20:00, cierra 02:00."""

    APERTURA = time(20, 0)
    CIERRE = time(2, 0)

    @pytest.mark.parametrize("hora,esperado", [
        (19, False),  # todavía cerrado
        (20, True),   # abre
        (22, True),   # servicio
        (23, True),   # antes de medianoche
        (0, True),    # medianoche: sigue abierto
        (1, True),    # madrugada, todavía en servicio
        (2, True),    # cierra
        (3, False),   # ya cerrado
        (12, False),  # mediodía, cerrado
    ])
    def test_franja(self, hora, esperado):
        assert en_horario_de_servicio(local(2026, 9, 5, hora), self.APERTURA, self.CIERRE) is esperado

    def test_una_comparacion_ingenua_daria_vacio(self):
        """Guarda contra la regresión más probable: volver a `apertura <= h <= cierre`.

        Con 20:00-02:00 esa forma no matchea NINGUNA hora del día. Si alguien
        "simplifica" en_horario_de_servicio, este test lo agarra.
        """
        horas_en_franja = [
            h for h in range(24)
            if en_horario_de_servicio(local(2026, 9, 5, h), self.APERTURA, self.CIERRE)
        ]
        assert horas_en_franja == [0, 1, 2, 20, 21, 22, 23]


class TestBordes:
    def test_apertura_igual_a_cierre_es_todo_el_dia(self):
        # Se lee como "abierto 24h", que es más plausible que "abierto un instante".
        for hora in (0, 8, 15, 23):
            assert en_horario_de_servicio(local(2026, 9, 5, hora), time(9, 0), time(9, 0)) is True

    def test_un_datetime_naive_se_asume_utc(self):
        """SQLite devuelve datetimes sin tzinfo. Interpretarlos como hora local en vez de
        UTC correría toda la franja tres horas sin que nada fallara a la vista."""
        naive = datetime(2026, 9, 5, 2, 30)
        assert hora_local(naive) == hora_local(naive.replace(tzinfo=timezone.utc))

    def test_convierte_al_huso_del_local_y_no_usa_utc_crudo(self):
        """A las 02:30 UTC en Montevideo son las 23:30 del día anterior. Un local
        cerrado a esa hora UTC puede estar en pleno servicio en hora local."""
        momento = utc(2026, 9, 5, 2, 30)
        assert hora_local(momento) == time(23, 30)
        assert en_horario_de_servicio(momento, time(20, 0), time(2, 0)) is True

    def test_el_desfasaje_es_el_del_huso_configurado(self):
        momento = utc(2026, 9, 5, 15, 0)
        desfasaje = momento.astimezone(TZ_LOCAL).utcoffset()
        assert desfasaje == timedelta(hours=-3)
