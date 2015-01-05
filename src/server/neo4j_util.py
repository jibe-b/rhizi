"""
 Utility code in speaking the neo4j REST api
"""

import json
import six
from six.moves.urllib import request
import six.moves.urllib_error as urllib_error
import model
import string
import time
import logging

from util import debug_log_duration

log = logging.getLogger('rhizi')

class Neo4JException(Exception):
    def __init__(self, error_set):
        self.error_set = error_set

    def __str__(self):
        return 'neo4j error set: ' + str(self.error_set)

class DB_row(object):
    def __init__(self, data):
        self.data = data

    def __iter__(self):
        for column_val in self.data:
            yield column_val

    def items(self):
        return [x for x in self]

    def __str__(self):
        return str(self.items())

    def __repr__(self):
        return repr(self.items())

class DB_result_set(object):
    def __init__(self, data):
        self.data = data

    def __iter__(self):
        for db_row_dict in self.data['data']:
            # example: dict: {u'row': [{u'title': u'foo'}]}
            assert None != db_row_dict['row']

            yield DB_row(db_row_dict['row'])

    def items(self):
        return [x for x in self]

class Cypher_String_Formatter(string.Formatter):
    """
    Despite parameter support in Cypher, we sometimes do engage in query string building
    - as both Cypher & Python use brackets to wrap parameters, escaping them in Python makes
    queries less readable. This customized formatter will simply ignore unavailable keyworded
    formatting arguments, allowing the use of non-escaped parameter designation, eg:
    q = cfmt("match (a:{type} {cypher_param})", type='Book')
    """

    def get_field(self, field_name, args, kwargs):
        # ignore key not found, return bracket wrapped key
        try:
            val = super(Cypher_String_Formatter, self).get_field(field_name, args, kwargs)
        except (KeyError, AttributeError):
            val = "{" + field_name + "}", field_name
        return val

def cfmt(fmt_str, *args, **kwargs):
    return Cypher_String_Formatter().format(fmt_str, *args, **kwargs)

def quote__backtick(label):
    """
    quote label (possibly containing spaces) with backticks
    """
    return '`' + label + '`'

def post_neo4j(url, data):
    """
    @return dict object from the neo4j json POST response
    """
    ret = post(url, data)
    ret_data = json.load(ret)

    # [!] do not raise exception if ret_data['errors'] is not empty -
    # this allows query-sets to partially succeed

    return ret_data

def post(url, data):
    assert(isinstance(data, dict))  # make sure we're not handed json strings

    post_data_json = json.dumps(data)

    req = request.Request(url)
    req.add_header('User-Agent', 'rhizi-server/0.1')
    req.add_header('Accept', 'application/json; charset=UTF-8')
    req.add_header('Content-Type', 'application/json')

    req.add_header('X-Stream', 'true')  # enable neo4j JSON streaming

    try:
        ret = request.urlopen(req, post_data_json)
    except urllib_error.HTTPError as e:
        raise Exception('post request failed: code: {0}, reason: {1}'.format(e.code, e.reason))

    return ret

def statement_to_REST_form(query, parameters={}):
    """
    turn cypher query to neo4j json API format
    """
    assert isinstance(query, six.string_types)

    if isinstance(parameters, list):
        for v in parameters:
            assert isinstance(v, dict)
    else:
        assert isinstance(parameters, dict)

    return {'statement' : query, 'parameters': parameters}

def statement_set_to_REST_form(statement_set):
    assert isinstance(statement_set, list)

    return {'statements': statement_set}

def gen_clause_attr_filter_from_filter_attr_map(filter_attr_map, node_label="n"):
    if not filter_attr_map:
        return "{}"

    __type_check_filter_attr_map(filter_attr_map)

    filter_arr = []
    for attr_name in filter_attr_map.keys():
        # create a cypher query parameter place holder for each attr set
        # eg. n.foo in {foo}, where foo is passed as a query parameter
        f_attr = cfmt("{attr_name}: {{{attr}}}", attr_name=attr_name)
        filter_arr.append(f_attr)

    filter_str = "{{{0}}}".format(', '.join(filter_arr))
    return filter_str

def gen_clause_where_from_filter_attr_map(filter_attr_map, node_label="n"):
    """
    convert a filter attribute map to a parameterized Cypher where clause, eg.
    in: { 'att_foo': [ 'a', 'b' ], 'att_goo': [1,2] }
    out: {att_foo: {att_foo}, att_goo: {att_goo}, ...}

    this function will essentially ignore all but the first value in the value list

    @param filter_attr_map: may be None or empty
    """
    if not filter_attr_map:
        return ""

    __type_check_filter_attr_map(filter_attr_map)

    filter_arr = []
    for attr in filter_attr_map.keys():
        # create a cypher query parameter place holder for each attr set
        # eg. n.foo in {foo}, where foo is passed as a query parameter
        f_attr = cfmt("{node_label}.{attr} in {{{attr}}}", node_label=node_label, attr=attr)
        filter_arr.append(f_attr)
    filter_str = "where {0}".format(' and '.join(filter_arr))
    return filter_str

def gen_query_create_from_node_map(node_map, input_to_DB_property_map=lambda _: _):
    """
    generate a set of node create queries

    @param node_map: is a node-type to node map
    @input_to_DB_property_map: optional function which takes a map of input 
    properties and returns a map of DB properties - use to map input schemas to DB schemas

    @return: a (query, query_parameteres) set of create queries
    """
    __type_check_link_or_node_map(node_map)

    ret = []
    for label, n_set in node_map.items():

        assert len(label) > 2 and label[0].isupper(), 'malformed label: ' + label

        q_arr = ['create (n:%s {node_attr})' % (quote__backtick(label)),
                 'return n, labels(n)'
                 ]

        q_params_set = []
        for n_prop_set in n_set:

            assert None != n_prop_set['id'], 'node create query: node id attribute not set'

            q_params = input_to_DB_property_map(n_prop_set)
            q_params_set.append(q_params)

        ret.append((q_arr, {'node_attr': q_params_set}))

    return ret

def gen_query_create_from_link_map(link_map, input_to_DB_property_map=lambda _: _):
    """
    generate a set of link create queries

    @param link_map: is a link-type to link map - see model.link
    """
    __type_check_link_or_node_map(link_map)

    ret = []
    for l_type, l_set in link_map.items():
        q = "match (src {id: {src}.id}),(dst {id: {dst}.id}) " + \
            "create (src)-[r:%(__type)s {link_attr}]->(dst) " + \
            "return r, src.id, dst.id, type(r)"
        q = q % {'__type': quote__backtick(l_type)}

        for link in l_set:
            __type_check_link(link)

            src_id = link['__src_id']
            dst_id = link['__dst_id']

            # TODO: use object based link representation
            prop_dict = link.copy()
            del prop_dict['__dst_id']
            del prop_dict['__src_id']

            q_params = {'src': { 'id': src_id} ,
                        'dst': { 'id': dst_id} ,
                        'link_attr' : input_to_DB_property_map(prop_dict)}
            ret.append((q, q_params))

    return ret

def meta_attr_list_to_meta_attr_map(e_set, meta_attr='__label_set'):
    """
    convert a list of maps each containing a meta_attr key into a
    meta_attr-mapped collection of lists with the meta_attr removed - eg:

        in: [{'id':0, '__type': 'T'}, {'id':1, '__type': 'T'}]
        out: { 'T': [{'id':0}, {'id':1}] }
    """
    ret = {}
    for v in e_set:
        assert None != v[meta_attr], 'missing type meta-attribute'
        assert 1 == len(v[meta_attr]), 'only single-type mapping currently suppoerted'

        v_type = v[meta_attr][0]
        if None == ret.get(v_type):  # init type list if necessary
            ret[v_type] = []

        v_no_meta = v.copy()
        del v_no_meta[meta_attr]

        ret[v_type].append(v_no_meta)

    return ret

def __type_check_link(link):
    assert link.has_key('__src_id')
    assert link.has_key('__dst_id')

def __type_check_link_or_node_map(x_map):
    for k, v in x_map.iteritems():  # do some type sanity checking
        assert isinstance(k, six.string_types)
        assert isinstance(v, list)

def __type_check_filter_attr_map(filter_attr_map):
    """
    # type sanity check an attribute filter map
    """
    assert isinstance(filter_attr_map, dict)
    for k, v in filter_attr_map.items():
        assert isinstance(k, six.string_types)
        assert isinstance(v, list)
