(function(){
  window.AI_CONFIG = {
    requirements: {
      outputFormatLine: '输出格式：请用中文给出简洁的交易建议（开/平仓条件、风控、止损止盈），并说明依据。',
      jsonBlockIntro: '【机器可读指令（严格JSON）】请在回复末尾追加一个```json 代码块，内容仅为以下结构，不得添加注释或多余字段：',
      jsonBlockTemplate: [
        '{"ops": [',
        '  {"action":"open","symbol":"BTCUSDT","side":"long|short","type":"market|limit","price":110000.0,"qty":0.01,"lev":10,"tp":111000.0,"sl":109000.0},',
        '  {"action":"close","symbol":"BTCUSDT"},',
        '  {"action":"set_brackets","symbol":"BTCUSDT","tp":111000.0,"sl":109000.0},',
        '  {"action":"cancel_all","symbol":"BTCUSDT"},',
        '  {"action":"close_all"}',
        ']}',
        '```'
      ],
      jsonBlockExplainLine: '字段含义：open为下单（市价可不填price；限价必须填写price；tp/sl可选），close为平指定交易对持仓，set_brackets为重置该交易对的TP/SL保护单（对冲模式分别作用于LONG/SHORT；市价触发，平掉全部持仓），cancel_all为撤销该交易对全部委托（不含TP/SL），close_all为平掉所有持仓。若需设置初始余额，追加{"action":"set_balance","initialBalance":10000}。',
      forceJsonOnly: true,
      fallbackJsonInstruction: '请仅输出一个JSON对象，形如 {"ops":[...]} ，不要输出任何其他文本。'
    }
  };
})();
