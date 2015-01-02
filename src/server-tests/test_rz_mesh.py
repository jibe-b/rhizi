from greenlet import greenlet
import json
import logging
from socketIO_client import SocketIO, BaseNamespace
import unittest
import urllib2

import test_util
from model.graph import Topo_Diff
from model.graph import Attr_Diff
from neo4j_test_util import rand_id

class TestMeshAPI(unittest.TestCase):
    """
    currently requires a running rhizi server instance
    """
    def setUp(self):
        pass

    @classmethod
    def setUpClass(self):
        logging.basicConfig(level=logging.DEBUG)

    @classmethod
    def tearDownClass(cls):
        pass

    class rz_socket:

        def __init__(self, namespace=BaseNamespace):
            self.namespace = namespace

        def __enter__(self):
            sock = SocketIO('rhizi.local', 8080)
            ns_sock = sock.define(self.namespace, '/graph')
            self.sock = sock
            return sock, ns_sock

        def __exit__(self, e_type, e_value, e_traceback):
            self.sock.disconnect()

    def _emit_tx_topo_diff(self):
        with TestMeshAPI.rz_socket() as (_, ns_sock):
            n_set = [{'__label_set': ['xxx'], 'id': rand_id() }]
            topo_diff = Topo_Diff(node_set_add=n_set)
            data = json.dumps(topo_diff, cls=Topo_Diff.JSON_Encoder)
            ns_sock.emit('diff_commit__topo', data)

    def test_REST_post_triggers_ws_multicast__topo_diff(self):

        class NS_test(BaseNamespace):

            def on_diff_commit__topo(self, json_str):
                topo_diff = Topo_Diff.from_json_dict(json_str)
                n_id = topo_diff.node_set_add[0].get('id')
                greenlet.getcurrent().n_id_received = n_id

                self._transport._connection.send_close()  # FIXME: properly close socket, avoid c_1 socket wait

        n = test_util.generate_random_node_dict('test_ws_event__topo_diff')
        n_id = n['id']
        topo_diff = Topo_Diff(node_set_add=[n])

        def c_0():

            with TestMeshAPI.rz_socket(namespace=NS_test) as (sock, _):
                c1_t.switch()  # allow peer to POST
                sock.wait(8)  # allow self to receive

        def c_1():
            data = json.dumps({'topo_diff': topo_diff.to_json_dict()})
            req = urllib2.Request(url='http://rhizi.local:8080/graph/diff-commit-topo',
                                  data=data,
                                  headers={'Content-Type': 'application/json'})

            f = urllib2.urlopen(req)
            f.close()
            c0_t.switch()

        c0_t = greenlet(c_0)
        c1_t = greenlet(c_1)
        c0_t.switch()
        self.assertEqual(c0_t.n_id_received, n_id)

    def test_ws_event__topo_diff(self):

        class NS_test(BaseNamespace):

            def on_diff_commit__topo(self, json_str):
                todo_diff = Topo_Diff.from_json_dict(json.loads(json_str))
                n_id = todo_diff.node_set_add[0].get('id')
                greenlet.getcurrent().n_id_received = n_id

                self._transport._connection.send_close()  # FIXME: properly close socket, avoid c_1 socket wait

        n = test_util.generate_random_node_dict('test_ws_event__topo_diff')
        n_id = n['id']
        topo_diff = Topo_Diff(node_set_add=[n])

        def c_0():
            with TestMeshAPI.rz_socket(namespace=NS_test) as (_, ns_sock):
                c1_t.switch()  # allow peer to connect
                data = json.dumps(topo_diff, cls=Topo_Diff.JSON_Encoder)
                ns_sock.emit('diff_commit__topo', data)
                c1_t.switch()

        def c_1():
            with TestMeshAPI.rz_socket(namespace=NS_test) as (sock, _):
                c0_t.switch()  # allow peer to emit
                sock.wait(8)  # allow self to receive

        c0_t = greenlet(c_0)
        c1_t = greenlet(c_1)
        c0_t.switch()

        self.assertEqual(c1_t.n_id_received, n_id)

    def test_ws_event__attr_diff(self):

        class NS_test(BaseNamespace):

            def on_diff_commit__attr(self, json_str):
                attr_diff = Attr_Diff.from_json_dict(json.loads(json_str))
                n_id = attr_diff.type_node.node_set_add[0].get('id')
                greenlet.getcurrent().n_id_received = n_id

                self._transport._connection.send_close()  # FIXME: properly close socket, avoid c_1 socket wait

        n = test_util.generate_random_node_dict('test_ws_event__attr_diff')
        n_id = n['id']

        # apply attr_diff
        attr_diff = Attr_Diff()
        attr_diff.add_node_attr_write(n_id, 'attr_0', 0)
        attr_diff.add_node_attr_write(n_id, 'attr_1', 'a')
        attr_diff.add_node_attr_rm(n_id, 'attr_2')

        def c_0():
            with TestMeshAPI.rz_socket(namespace=NS_test) as (_, ns_sock):
                c1_t.switch()  # allow peer to connect
                data = json.dumps(attr_diff)
                ns_sock.emit('diff_commit__attr', data)
                c1_t.switch()

        def c_1():
            with TestMeshAPI.rz_socket(namespace=NS_test) as (sock, _):
                c0_t.switch()  # allow peer to emit
                sock.wait(8)  # allow self to receive

        c0_t = greenlet(c_0)
        c1_t = greenlet(c_1)
        c0_t.switch()

        self.assertEqual(c1_t.n_id_received, n_id)

if __name__ == "__main__":

    unittest.main()

