
function asciiToBytes(ascii_str){
	var bytes = new Uint8Array(ascii_str.length);
	for(var i = 0;i < ascii_str.length;i++){
		bytes[i] = ascii_str.charCodeAt(i);
	}
	return bytes;
}


function printBytes (bytes){
	var str = '+0 +1 +2 +3 +4 +5 +6 +7 +8 +9 +A +B +C +D +E +F';
	for(var i = 0;i < bytes.length;i++){
		if(i % 0x10 === 0)
		{
			str += '\n';
		}else{
			str += ' ';
		}
		var tmp = bytes[i].toString(16);
		if(tmp.length === 1) str += '0';
		str += tmp;
	}
	console.log(str);
}

function Uint8ToBytes(num){
	var bytes = new Uint8Array(1);
	bytes[0] = num & 0xff;
	return bytes;
}


function Uint16ToBytes(num){
	var bytes = new Uint8Array(2);
	bytes[0] = num & 0xff;
	bytes[1] = (num & 0xff00) >> 8;
	return bytes;
}

function Int16ToBytes(num){
	if(num < 0){
		num *= -1;
		num = ((num & 0xffff) ^ 0xffff)+1;
	}
	var bytes = new Uint8Array(2);
	bytes[0] = num & 0xff;
	bytes[1] = (num & 0xff00) >> 8;
	return bytes;
}

function Uint32ToBytes(num){
	var bytes = new Uint8Array(4);
	bytes[0] = num & 0xff;
	bytes[1] = (num & 0xff00) >> 8;
	bytes[2] = (num & 0xff0000) >> 16;
	bytes[3] = (num & 0xff000000) >> 24;
	return bytes;
}


var wav = (function(){
	function readChunk(reader, chunks){
		var chunkId = reader.readAsciiString(4);
		var chunkSize = reader.readUint32();
		var chunk = {
			id:chunkId,
			size:chunkSize
		};
		switch(chunkId){
			case 'RIFF':
				chunk.format = reader.readAsciiString(4);
				break;
			case 'fmt ':
				readFmt(reader, chunk);
				break;
			case 'data':
				readData(reader, chunk, chunks['fmt ']);
				break;
			default:
				chunk.data = reader.readBytes(chunkSize);
				break;
		}
		return chunk;
	}

	function readFmt(reader, chunk){
		chunk.formatID = reader.readUint16();
		chunk.channels = reader.readUint16();
		chunk.samplingRate = reader.readUint32();
		chunk.bitRate = reader.readUint32();
		chunk.blockSize = reader.readUint16();
		chunk.bitPerSample = reader.readUint16();
		if(chunk.size != 16){
			chunk.eSize = reader.readUint16();
			chunk.eField = reader.readBytes(chunk.eSize);
		}
	}

	function readData(reader, chunk, fmtChunk){
		if(fmtChunk){
			if(fmtChunk.bitPerSample !== 16 && fmtChunk.bitPerSample !== 8){
				chunk.data = reader.readBytes(chunk.size);
				return;
			}else{
				var sampleLength = chunk.size / ((fmtChunk.bitPerSample / 8) * fmtChunk.channels);
				var dataArray;
				var readFunc;
				if(fmtChunk.bitPerSample === 8){
					readFunc = reader.readUint8;
				}else{
					readFunc = reader.readInt16;
				}
				chunk.sampleNum = sampleLength;
				chunk.left = new Int32Array(sampleLength);
				chunk.right = (fmtChunk.channels !== 1)? new Int32Array(sampleLength): null;
				for(var i = 0;i < sampleLength;i++){
					chunk.left[i] = readFunc.call(reader);
					if(fmtChunk.channels !== 1){
						chunk.right[i] = readFunc.call(reader);
					}
				}
				return;
			}
		}
	}

	function wav(data){
		if(data instanceof Uint8Array){
			this.raw= data;
			var reader = new binaryReader(data);
			var chunk = readChunk(reader);
			this.chunks = {};
			this.chunks[chunk.id] = chunk;
			if(chunk.id === 'RIFF'){
				var size = chunk.size - 4;
				try{
					while(size > 7){
						chunk = readChunk(reader, this.chunks);
						this.chunks[chunk.id] = chunk;
						size -= chunk.size + 8;
					}
				}catch(e){
					console.log(e.toString());
				}
			}

		}else if(typeof data === 'object' && data.RIFF){
			this.raw = null;
			this.chunks = data;
		}else{
			throw 'args error';
		}
	}

	/*
		波形合成
		pos:開始ミリ秒
		targetWab:合成するwav
		サンプリングレートとチャンネル数が同じでないといけない
	*/
	function addWav(pos, targetWav){
		var fmt = this.chunks['fmt '];
		var targetFmt = targetWav.chunks['fmt'];
		var flag = fmt.channels === targetFmt && fmt.channels === 2;
		var offset = Math.floor((pos/1000) * fmt.channels * fmt.samplingRate) & 0xfffffffe;

		var overflow = -1;
		var overflows = {};
		var left_buf, right_buf;
		var length = targetWav.chunks.data.sampleNum+offset;
		if(length > this.chunks.data.sampleNum){
			length = this.chunks.data.sampleNum - offset;
		}else{
			length = targetWav.chunks.data.sampleNum;
		}

		for(var i = 0;i < length;i++){
			var w1 = this.chunks.data.left[i+offset];
			var w2 = targetWav.chunks.data.left[i];
			this.chunks.data.left[i+offset] = w1+w2;
			if(flag){
				var w1 = this.chunks.data.right[i+offset];
				var w2 = targetWav.chunks.data.right[i];
				this.chunks.data.right[i+offset] = w1+w2;
			}
		}

	}

	wav.prototype = {
		add:addWav
	};

	return wav;
})();

/*
モノラル,リニアPCM,量子化精度16bitのwavを作成する
*/
var createWav = (function(){
	function createWav(samplingRate, millisec){
		var dataSize = Math.floor(2*samplingRate*(millisec/1000)) & 0xfffffffe;

		var riff = {
			id:'RIFF',
			size:dataSize + 36,
			format:'WAVE'
		};

		var fmt = {
			id:'fmt ',
			size:16,
			formatID:1,
			channels:1,
			samplingRate:samplingRate,
			bitRate:samplingRate * 2,
			blockSize:2,
			bitPerSample:16
		};

		var data = {
			id:'data',
			size:dataSize,
			sampleNum:dataSize / 2,
			left:new Int32Array(dataSize / 2),
			right:null
		};

		return new wav({
			'RIFF':riff,
			'fmt ':fmt,
			'data':data
		});
	}

	return createWav;
})();

var createWavURL = (function(){
	function createWavURL(data){
		if(data instanceof wav){
			var buffer = new Uint8Array(data.chunks.RIFF.size + 8);
			var pos = 0;
			function write(array,_pos){
				if(_pos === undefined) _pos = pos;
				buffer.set(array, pos);
				pos += array.length;
			}
			write(asciiToBytes('RIFF'));
			write(Uint32ToBytes(0));	//ファイルサイズ
			write(asciiToBytes('WAVE'));
			var fmt = data.chunks['fmt '];
			write(asciiToBytes('fmt '));	//fmtチャンク
			write(Uint32ToBytes(16));
			write(Uint16ToBytes(fmt.formatID));
			write(Uint16ToBytes(fmt.channels));
			write(Uint32ToBytes(fmt.samplingRate));
			write(Uint32ToBytes(fmt.bitRate));
			write(Uint16ToBytes(fmt.blockSize));
			write(Uint16ToBytes(fmt.bitPerSample));
			write(asciiToBytes('data'));
			var d = data.chunks['data'];
			write(Uint32ToBytes(d.size));
			var rate = 1;
			var const_max = (fmt.bitPerSample === 8)? 0xff : 0x7fff;
			var max = const_max;
			for(var i = 0;i < d.sampleNum;i++){
				if(d.left[i] > max){
					max = d.left[i];
				}
				if(fmt.channels !== 1){
					if(d.right[i] > max){
						max = d.left[i];
					}
				}
			}
			rate = const_max / max;
			for(var i = 0;i < d.sampleNum;i++){
				if(fmt.bitPerSample === 16){
					write(Int16ToBytes(d.left[i]*rate));
				}else{
					write(Uint8ToBytes(d.left[i]*rate));
				}
				if(fmt.channels !== 1){
					if(fmt.bitPerSample === 16){
						write(Int16ToBytes(d.right[i]*rate));
					}else{
						write(Uint8ToBytes(d.right[i]*rate));
					}
				}
			}

			var size = pos;
			pos = 4;
			write(Uint32ToBytes(size-8));
			return (window.URL || window.webkitURL).createObjectURL(new Blob([buffer.subarray(0, size)], {'type':'audio/wav'}));
		}else{
			throw 'data is not wav';
		}
	}

	return createWavURL;
})();
