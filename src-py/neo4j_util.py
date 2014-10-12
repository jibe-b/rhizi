"""
 Utility code in speaking the neo4j REST api
"""

import json
import urllib2
import model
import string

class DB_result_set(object):
    def __init__(self, data):
        self.data = data

    def __iter__(self):
        for db_row_dict in self.data['data']:
            # example: dict: {u'row': [{u'title': u'foo'}]}
            assert None != db_row_dict['row'][0]

            yield db_row_dict['row'][0]

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
            val=super(Cypher_String_Formatter, self).get_field(field_name, args, kwargs)
        except (KeyError, AttributeError):
            val="{" + field_name + "}", field_name
        return val

def cfmt(fmt_str, *args, **kwargs):
    return Cypher_String_Formatter().format(fmt_str, *args, **kwargs)

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

    req = urllib2.Request(url)
    req.add_header('User-Agent', 'rhizi-server/0.1')
    req.add_header('Accept', 'application/json; charset=UTF-8')
    req.add_header('Content-Type', 'application/json')

    try:
        ret = urllib2.urlopen(req, post_data_json)
    except urllib2.HTTPError as e:
        raise Exception('post request failed: code: {0}, reason: {1}'.format(e.code, e.reason))

    return ret

def statement_to_REST_form(query, parameters={}):
    """
    turn cypher query to neo4j json API format
    """
    assert isinstance(query, basestring)
    assert isinstance(parameters, dict)

    return {'statement' : query, 'parameters': parameters}

def statement_set_to_REST_form(statement_set):
    assert isinstance(statement_set, list)

    return {'statements': statement_set}

def gen_clause_where_from_filter_attr_map(filter_attr_map, node_label="n"):
    """
    convert a filter attribute map to a parameterized Cypher where clause, eg.
    in: { 'att_foo': [ 'a', 'b' ], 'att_goo': [1,2] }
    out: where n.att_foo in {att_foo} and n.att_goo in {att_goo} ...
    
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
    @input_to_DB_property_map: optional function which takes a map of input properties and returns a map of DB properties - use to map input schemas to DB schemas
    
    @return: a (query, query_parameteres) set of create queries
    """
    __type_check_link_or_node_map(node_map)

    ret = []
    for n_type, n_set in node_map.items():
        q = cfmt("create (n:{n_type} {node_attr}) return id(n)", n_type=n_type)
        q_params_set = []
        for n_prop_set in n_set:
            q_params = input_to_DB_property_map(n_prop_set)
            q_params_set.append(q_params)
        ret.append((q, {'node_attr': q_params_set}))
    return ret

def gen_query_create_from_link_map(link_map, input_to_DB_property_map=lambda _: _):
    """
    generate a set of link create queries
    
    @param link_map: is a link-type to link map - see model.link
    """
    q_params_set = []
    for l_type, l_set in link_map.items():

        for link in l_set:
            __type_check_link(link)

            n_src = link['__src']
            n_dst = link['__dst']

            # TODO: use object based link representation
            prop_dict = link.copy()
            del prop_dict['__dst']
            del prop_dict['__src']

            q_params = {'src': { 'id': n_src} ,
                        'dst': { 'id': n_dst} ,
                        'link_attr' : input_to_DB_property_map(prop_dict)}
            q_params_set.append(q_params)

    q = "match (src {id: {src}.id}),(dst {id: {dst}.id}) create (src)-[:%(l_type)s {link_attr}]->(dst)" % {'l_type':l_type}
    return (q, q_params_set)

def __type_check_link(link):
    assert link.has_key('__src')
    assert link.has_key('__dst')

def __type_check_link_or_node_map(x_map):
    for k, v in x_map.iteritems():  # do some type sanity checking
        assert isinstance(k, basestring)
        assert isinstance(v, list)

def __type_check_filter_attr_map(filter_attr_map):
    """
    # type sanity check an attribute filter map
    """
    assert isinstance(filter_attr_map, dict)
    for k, v in filter_attr_map.items():
        assert isinstance(k, basestring)
        assert isinstance(v, list)
