"use strict"

define(['jquery', 'd3', 'consts', 'signal', 'util', 'model/graph', 'view/helpers', 'view/view'],
function($, d3, consts, signal, util, model_graph, view_helpers, view) {

var addednodes = [];

var vis;

var graphstate = "GRAPH";
var graphinterval = 0;

var ganttTimer = 0;

var deliverables = [];

var circle; // <-- should not be module globals.

var scrollValue = 0,
    zoomObject;

var graph;

var drag;

var force;

var state_to_link_class = {
    enter:'enterlink graph',
    exit:'exitlink graph',
};

function recenterZoom() {
    vis.attr("transform", "translate(0,0)scale(1)");
}

var initDrawingArea = function () {

    function zoom() {
        if (graphstate === "GRAPH") {
            vis.attr("transform", "translate(" + d3.event.translate + ")scale(" + d3.event.scale + ")");
        }
        if (graphstate === "GANTT") {
            vis.attr("transform", "translate(0,0)scale(1)");
        }
    }

    function dragstarted(d) {
        d3.event.sourceEvent.stopPropagation();
        d3.select(this).classed("dragging", true);
        d.dragstart = {clientX:d3.event.sourceEvent.clientX, clientY:d3.event.sourceEvent.clientY};
        force.stop();
    }

    function dragged(d) {
        d3.select(this).attr("cx", d.x = d3.event.x).attr("cy", d.y = d3.event.y);
        tick();
    }

    function dragended(d) {
        d3.select(this).classed("dragging", false);
        d3.select(this).classed("fixed", true);
        d3.select(this).attr("dx", d3.event.x).attr("dy", d3.event.y);
        if (d.dragstart.clientX - d3.event.sourceEvent.clientX != 0 ||
            d.dragstart.clientY - d3.event.sourceEvent.clientY != 0) {
            tick();
            force.resume();
        }
    }

    var el = document.body;

    graph = new model_graph.Graph(el);

    //Zoom scale behavior in zoom.js
    zoomObject = d3.behavior.zoom().scaleExtent([0.1, 3]).on("zoom", zoom);
    
    vis = d3.select(el).append("svg:svg")
        .attr('id', 'canvas_d3')
        .attr("width", '100%')
        .attr("height", '100%')
        .attr("pointer-events", "all")
        .call(zoomObject)
        .append("g")
        .attr("class", "zoom");

    // TODO: why do we need this huge overlay (hugeness also not constant)
    vis.append("rect")
        .attr("class", "overlay graph")
        .attr("width", $(el).innerWidth() * 12)
        .attr("height", $(el).innerHeight() * 12)
        .attr("x", -$(el).innerWidth() * 5)
        .attr("y", -$(el).innerHeight() * 5);
    $('.overlay').click(mousedown);

    // SVG rendering order is last rendered on top, so to make sure
    // all links are below the nodes we group them under a single g
    vis.append("g").attr("id", "link-group");

    drag = d3.behavior.drag()
    .origin(function(d) { return d; })
    .on("dragstart", dragstarted)
    .on("drag", dragged)
    .on("dragend", dragended);

    var w = $(el).innerWidth(),
        h = $(el).innerHeight();

    force = d3.layout.force()
        .distance(120)
        .gravity(0.12)
        .charge(-1800)
        .size([w, h])
        .on("tick", tick)
        .start();

    graph.update = update;
}

initDrawingArea();

function update(no_relayout) {
    var node, link, linktext, nodetext;

    link = vis.select("#link-group").selectAll(".link")
        .data(graph.links());

    link.enter().append("svg:defs").selectAll("marker")
        .data(["end"]) // Different link/path types can be defined here
        .enter().append("svg:marker") // This section adds in the arrows
        .attr("id", String)
        .attr("viewBox", "0 -5 10 10")
        .attr("refX", 22)
        .attr("refY", -1.5)
        .attr("markerWidth", 4)
        .attr("markerHeight", 4)
        .attr("orient", "auto")
        .attr("class", "graph")
        .style("fill", function(d){
            if (d.state==="enter" || d.state==="exit") {
                return "EDE275";
            } else {
                return "#aaa";
            }
            })
        .append("svg:path")
        .attr("d", "M0,-5L10,0L0,5");

    link.enter().append("path")
        .attr("d", "M0,-5L10,0L0,5")
        .attr("class", function(d) {
            return state_to_link_class[d.state] || 'link graph';
        })
        .attr("marker-end", "url(#end)")
        .on("click", function(d, i) {
            //$('#textanalyser').val("node("+d.source.id+") -> "+d.name+" -> node("+d.target.id+")");
        });;
    link.style("stroke-dasharray", function(d,i){
        if(d.name && d.name.replace(/ /g,"")=="and" && d.state==="temp")
            return "3,3";
        else
            return "0,0";
        });

    link.exit().remove();

    linktext = vis.selectAll(".linklabel").data(graph.links());
    linktext.enter()
        .append("text")
        .attr("class", "linklabel graph")
        .attr("text-anchor", "middle")
        .on("click", function(d, i) {
            if (d.state !== "temp") {
                editLink(this, d, i);
            }
        });

    linktext
        .text(function(d) {
            var name = d.name || "";
            if (!(d.target.state === "temp" ||
                d.source.state === "chosen" || d.target.state === "chosen")) {
                return "";
            }
            if (name.length < 25 || d.source.state === "chosen" ||
                d.target.state === "chosen" || d.state==="temp") {
                return name;
            } else {
                return name.substring(0, 14) + "...";
            }
        });

    linktext.exit().remove();

    node = vis.selectAll(".node")
        .data(graph.nodes(), function(d) {
            return d.id;
        });

    var nodeEnter = node.enter()
        .append("g").attr('class', 'node')
        .attr('visibility', 'hidden') // made visible on first tick
        .on("click", function(d, i) {
            if (d3.event.defaultPrevented) {
                // drag happened, ignore click https://github.com/mbostock/d3/wiki/Drag-Behavior#on
                return;
            }
            if (d.state !== "temp"){
                editNode(this, d, i);
                showInfo(d, i);
            }
        })
        .call(drag);

    nodetext = nodeEnter.insert("text")
        .attr("class", "nodetext graph")
        .attr("dx", 15)
        .attr("dy", ".30em");

    node.select('g.node text')
        .text(function(d) {
            if (!d.name) {
                return "";
            }
            if (d.state === "temp" || d.state === 'chosen'
             || d.state === "enter" || d.state === "exit") {
                 return d.name;
            } else {
                if (d.name.length < 28) {
                    return d.name;
                } else {
                    return d.name.substring(0, 25) + "...";
                }
            }
        });

    circle = nodeEnter.insert("circle");
    node.select('g.node circle')
        .attr("class", "circle graph")
        .attr("r", function(d) {
            return customSize(d.type) - 2;
        })
        .style("fill", function(d) {
            return view_helpers.customColor(d.type);
        })
        .style("stroke", function(d) {
            if (d.state === "chosen") return "#EDE275";
            if (d.state === "enter") return "#EDE275";
            if (d.type === "bubble") return "#101010";
            if (d.state === "exit")  return "#EDE275";
            if (d.type === "chainlink")  return "#AAA";

            return "#fff";
        })
        .style("stroke-width", function(d) {
            if (d.state === "temp" && d.type !== "empty" || d.state === "chosen") return "3px";
            else return "1.5px";
        })
        .style("box-shadow", function(d) {
            if (d.state === "temp") return "0 0 40px #FFFF8F";
            else return "0 0 0px #FFFF8F";
        })
        .on("click", function(d, i) {
            if (d3.event.defaultPrevented) {
                // drag happened, ignore click https://github.com/mbostock/d3/wiki/Drag-Behavior#on
                return;
            }
            d3.event.stopPropagation();
            if(d.state!=="temp") {
                showInfo(d, i);
            } else {
                removeHighlight();
            }
            update(true);
        });

    //if(graphstate==="GANTT"){
    nodeEnter.append("svg:image")
        .attr("class", "status graph")
        .attr('x', -7)
        .attr('y', -8)
        .attr('width', 15)
        .attr('height', 15)
        .attr("xlink:href", function(d) {
            switch (d.status) {
                case "done":
                    return "res/img/check.png";
                    break;
                case "current":
                    return "res/img/wait.png";
                    break;
                case "waiting":
                    return "res/img/cross.png";
                    break;
            }
        })
        .on("click", function(d, i) {
            if(d.state!=="temp")showInfo(d, i);
        });
    //}

    node.exit().remove();

    //update deliverables
    deliverables = [];
    var nodes = graph.nodes();
    for (var i = 0; i < nodes.length; i++) {
        var current = nodes[i];
        if (current.type === "deliverable") {
            deliverables.push({
                "id": nodes[i].id,
                "startdate": nodes[i].start,
                "enddate": nodes[i].end
            });
        }
        //Do something
    }

    force.nodes(graph.nodes())
        .links(graph.links())

    if (no_relayout) {
        // XXX If we are stopped we need to update the text of the links at least,
        // and this is the simplest way
        tick();
    } else {
        force.alpha(0.1).start();
    }
}



var debug_print = function(message) {
    var element = $(".debug");
    if (element.length == 1) {
        element.html(message);
    } else {
        console.log(message);
    }
}

function check_for_nan(x) {
    if (Number.isNaN(x)) {
        console.log('nan problem');
        force.stop();
    }
    return Number.isNaN(x);
}

var newnodes=1;
function tick(e) {
    //console.log(e);
    //$(".debug").html(force.alpha());
    var node = vis.selectAll(".node")
        .data(force.nodes(), function(d) {
            return d.id;
        });
    var link = vis.select("#link-group").selectAll(".link")
        .data(graph.links());
    var linktext = vis.selectAll(".linklabel").data(graph.links());

    function transform(d) {
        if (graphstate === "GRAPH" || d.type === "deliverable") {
            if (check_for_nan(d.x) || check_for_nan(d.y)) {
                return;
            }
            if (d.state === "temp") {
                return "translate(" + d.x + "," + d.y + ")";
            } else {
                return "translate(" + d.x + "," + d.y + ")";
            }
        } else {
            return "translate(0,0)";
        }
        return "translate(" + d.x + "," + d.y + ")";
    }

    if (graphstate === "GANTT") {
        var k = 20 * e.alpha;
        var today = new Date();
        var missingcounter = 0;

        graph.nodes().forEach(function(d, i) {
            if ((d.start === 0 || d.end === 0)) {
                d.x = 450 + missingcounter * 100;
                d.y = window.innerWidth / 2;
                if (missingcounter >= 6) {
                    d.x = 450 + (missingcounter - 6) * 100;
                    d.y = window.innerWidth / 2 + 50;
                }
                missingcounter++;
            } else {
                //var min= 150+graphinterval*Math.ceil(Math.abs(d.start.getTime() - today.getTime()) / (1000 * 3600 * 24)) - $('.gantbox').scrollLeft();
                //var max= 150+graphinterval*Math.ceil(Math.abs(d.end.getTime() - d.start.getTime()) / (1000 * 3600 * 24)) - $('.gantbox').scrollLeft();
                //d.x = min+Math.sin(today.getTime()/1000*Math.PI*2/10)*max;
                ganttTimer++;
                if (ganttTimer < 3000) {
                    d.x = 150 + graphinterval * Math.ceil(Math.abs(d.start.getTime() - today.getTime()) / (1000 * 3600 * 24)) * ganttTimer / 3000;
                    d.y = 150 + d.start.getHours() * 17;
                } else {
                    d.x = 150 + graphinterval * Math.ceil(Math.abs(d.start.getTime() - today.getTime()) / (1000 * 3600 * 24));
                    d.y = 150 + d.start.getHours() * 17;
                }
            }
            if (d.state === "chosen") {
                scrollValue = d.x;
            }
        });
    } else {
        //circles animation
        var tempcounter = 0;
        var temptotal = 0;
        graph.nodes().forEach(function(d, i) {
            if (d.state === "temp" && d.type!=="chainlink" && d.type!=="bubble") {
                temptotal++;
            }
        });
        if(temptotal!==newnodes){
                newnodes+=temptotal/15/(newnodes*newnodes);
        }
        if(newnodes>=temptotal){
            newnodes=temptotal;
        }
        if(newnodes<1)newnodes=1;
        graph.nodes().forEach(function(d, i) {
            if (d.state === "temp") {
                tempcounter++;
                if(d.type==="chainlink" || d.type==="bubble"){
                     d.x = window.innerWidth / 2;
                     d.y = window.innerHeight / 2;
                } else {
                    d.x = window.innerWidth / 2 + (60+newnodes*20) * Math.cos(-Math.PI+Math.PI * 2 * (tempcounter-1) / newnodes+0.3);
                    d.y = window.innerHeight / 2 + (60+newnodes*20)  * Math.sin(-Math.PI+Math.PI * 2 * (tempcounter-1) / newnodes+0.3);
                }
                check_for_nan(d.x);
                check_for_nan(d.y);
            }
        });
    }

    link.attr("d", function(d) {
        if (graphstate === "GRAPH") {
            var dx = d.target.x - d.source.x,
                dy = d.target.y - d.source.y,
                dr = Math.sqrt(dx * dx + dy * dy);
            return "M" + d.source.x + "," + d.source.y + "A" + dr + "," + dr + " 0 0,1 " + d.target.x + "," + d.target.y;
        } else if (graphstate === "GANTT") {
            if (d.state === "enter" || d.state === "exit") {
                var dx = d.target.x - d.source.x,
                    dy = d.target.y - d.source.y,
                    dr = Math.sqrt(dx * dx + dy * dy) * 5;
                return "M" + d.source.x + "," + d.source.y + "A" + dr + "," + dr + " 0 0,1 " + d.target.x + "," + d.target.y;
            } else {
                var dx = d.target.x - d.source.x,
                    dy = d.target.y - d.source.y,
                    dr = Math.sqrt(dx * dx + dy * dy) * 5;

                return "M" + 0 + "," + 0 + "A" + dr + "," + dr + " 0 0,1 " + 0 + "," + 0;
            }
        }
    });


    linktext.attr("transform", function(d) {
        if (graphstate === "GRAPH") {
            return "translate(" + (d.source.x + d.target.x) / 2 + "," + (d.source.y + d.target.y) / 2 + ")";
        } else {
            return "translate(0,0)";
        }
    });

    node.attr("transform", transform);

    // After initial placement we can make the nodes visible.
    //links.attr('visibility', 'visible');
    node.attr('visibility', 'visible');
}

function removeHighlight() {
    // TODO: stop manipulating state
    var nodes = graph.nodes(),
        links = graph.links(),
        k = 0, j = 0;

    while (k < nodes.length) {
        if (nodes[k]['state'] === "enter" || nodes[k]['state'] === "exit" || nodes[k]['state'] === "chosen") {
            nodes[k]['state'] = "perm";
        }
        k++;
    }
    while (j < links.length) {
        links[j]['state'] = "perm";
        j++;
    }
}

function highlight(n)
{
    var connected = graph.getConnectedNodesAndLinks(n, 1),
        i,
        data;

    n.state = 'chosen';

    for (i in connected.nodes) {
        data = connected.nodes[i];
        node = data.node;
        switch (data.type) {
        case 'exit':
            node.state = 'exit';
            break;
        case 'enter':
            node.state = 'enter';
            break;
        };
    }
}

function showInfo(d, i) {
  if (d.state !== "chosen" && d.state !== 'temp') {
    highlight(d);
    view.node_info.show(d);
    view.node_info.on_submit(function() {
      if (d.type === "deliverable") {
        graph.editDates(d.id, null, new Date($("#editstartdate").val()), new Date($("#editenddate").val()));
      }
      graph.editType(d.id,d.type,$('#edittype').val());
      graph.editURL(d.id, d.type, $('#editurl').val());
      graph.update(true);
      return false;
    });
    view.node_info.on_delete(function() {
      if (confirm('This node and all its connections will be deleted, are you sure?')) {
        graph.removeNode(d.id, null);
        graph.update(false);
        view.node_info.hide();
      }
    });
  } else {
    removeHighlight();
    view.node_info.hide();
  }
  graph.update(true);
}

function mousedown() {
    $('.editinfo').css('top', -100);
    $('.editinfo').css('left', 0);
    $('.editlinkinfo').css('top', -100);
    $('.editlinkinfo').css('left', 0);
    removeHighlight();
    view.hide();
    graph.update(true);
}

function AddedUnique(newnode) {
    truth = true;
    for (var p = 0; p < addednodes.length; p++) {
        if (addednodes[p] === newnode) {
            truth = false;
        }
    }
    return truth;
}


$('#editform').keypress(function(e) {
    signal.signal(consts.KEYSTROKES, [{where: consts.KEYSTROKE_WHERE_EDIT_NODE, keys: [e.which]}]);
    if (e.which == 13) {
        $('.editinfo').css('top', -100);
        $('.editinfo').css('left', 0);
        var element = $('#editname');
        var newname = element.val();
        var d = element.data().d;
        graph.editName(d.id, newname);
        graph.update(true);
        return false;
    }
});


function editNode(node, d, i) {
    var oldname = d.name;
    var element = $('#editname');
    var offset = $(node).find('.nodetext').offset();

    $('.editinfo').css('top', offset.top);
    $('.editinfo').css('left', offset.left);
    element.val(oldname);
    element.data().d = d;
}

function editLink(link, d, i) {
    var offset = $(link).offset(),
        oldname = d.name;

    $('.editlinkinfo').css('top', offset.top);
    $('.editlinkinfo').css('left', offset.left);
    $('#editlinkname').val(oldname);

    // TODO: handle escape as well to quit without changes (enter does submit)
    $('#editlinkform').submit(function() {
        graph.editLink(d.source.id, d.target.id, $('#editlinkname').val());
        $('.editlinkinfo').css('top', -100);
        $('.editlinkinfo').css('left', 0);
        graph.update(true);

        return false;
    });

    graph.update(true);
}

function customSize(type) {
    var size;
    switch (type) {
        case "person":
            size = 12;
            break;
        case "project":
            size = 12;
            break;
        case "skill":
            size = 12;
            break;
        case "deliverable":
            size = 12;
            break;
        case "objective":
            size = 12;
            break;
        case "empty":
            size = 9;
            break;
        case "chainlink":
            size = 8;
            break;
        case "bubble":
            size = 180;
            break;
        default:
            size = 9;
            break;
    }
    return size;
}

return {
    graph: graph,
    force: force,
    load_from_json: function(result) {
        graph.load_from_json(result);
        recenterZoom();
        update(false);
    }
}
}); /* close define call */
