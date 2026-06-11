#include "dashboard.h"

#include <SPIFFS.h>
#include <ArduinoJson.h>
#include <time.h>
#include <map>
static const char *LOG_FILE = "/usage_log.csv";

void dashboardInit()
{
    configTime(
        7 * 3600,
        0,
        "pool.ntp.org",
        "time.nist.gov");

    if (!SPIFFS.exists(LOG_FILE))
    {
        File f = SPIFFS.open(LOG_FILE, FILE_WRITE);

        if (f)
        {
            f.println("time,device,action");
            f.close();
        }
    }
}

void dashboardLogEvent(
    const String &device,
    bool isOn)
{
    time_t now;
    time(&now);

    if (now < 100000)
        return;

    File f =
        SPIFFS.open(
            LOG_FILE,
            FILE_APPEND);

    if (!f)
        return;

    f.printf(
        "%lu,%s,%s\n",
        (uint32_t)now,
        device.c_str(),
        isOn ? "ON" : "OFF");

    f.close();
}

static int getDayDiff(
    time_t now,
    time_t logTime)
{
    struct tm nowTm;
    struct tm logTm;

    localtime_r(&now, &nowTm);
    localtime_r(&logTime, &logTm);

    nowTm.tm_hour = 0;
    nowTm.tm_min = 0;
    nowTm.tm_sec = 0;

    logTm.tm_hour = 0;
    logTm.tm_min = 0;
    logTm.tm_sec = 0;

    time_t nowDay = mktime(&nowTm);
    time_t logDay = mktime(&logTm);

    return (nowDay - logDay) / 86400;
}
String dashboardGetJson()
{
    DynamicJsonDocument doc(32768);
    doc["today"]=0;
    doc["week"]=0;
    doc["month"]=0;

    JsonArray weekGraph=doc.createNestedArray("weekGraph");
    JsonArray monthGraph=doc.createNestedArray("monthGraph");

    for(int i=0;i<7;i++) weekGraph.add(0);
    for(int i=0;i<30;i++) monthGraph.add(0);

    JsonArray devices=doc.createNestedArray("devices");

    time_t now; time(&now);

    uint32_t todayCount=0, weekCount=0, monthCount=0;
    String todayTopDevice="", weekTopDevice="", monthTopDevice="";
    uint32_t todayTopCountMax=0, weekTopCountMax=0, monthTopCountMax=0;
    std::map<String,uint32_t> todayDev, weekDev, monthDev;


    struct DeviceStat{
        uint32_t onCount=0, offCount=0, totalSeconds=0;
        bool active=false;
        uint32_t startTime=0;
    };

    std::map<String, DeviceStat> stats;

    File f=SPIFFS.open(LOG_FILE, FILE_READ);
    if(f){
        f.readStringUntil('\n');
        while(f.available()){
            String line=f.readStringUntil('\n');
            line.trim();
            if(!line.length()) continue;

            int p1=line.indexOf(',');
            int p2=line.indexOf(',', p1+1);
            if(p1<0 || p2<0) continue;

            uint32_t ts=line.substring(0,p1).toInt();
            String device=line.substring(p1+1,p2);
            String action=line.substring(p2+1);

            int diff=getDayDiff(now, ts);
            if(diff<0) continue;

            if(diff==0){ todayCount++; todayDev[device]++; }
            if(diff<7){ weekCount++; weekDev[device]++; weekGraph[6-diff]=weekGraph[6-diff].as<int>()+1; }
            if(diff<30){ monthCount++; monthDev[device]++; monthGraph[29-diff]=monthGraph[29-diff].as<int>()+1; }

            if(!stats.count(device)) stats[device]=DeviceStat();

            if(action=="ON"){
                if(!stats[device].active){
                stats[device].onCount++;
                stats[device].active=true;
                stats[device].startTime=ts;
                }
            }else if(action=="OFF"){
                stats[device].offCount++;
                if(stats[device].active && ts>stats[device].startTime)
                    stats[device].totalSeconds += (ts-stats[device].startTime);
                stats[device].active=false;
            }
        }
        f.close();
    }

    
    for(auto &p: todayDev){ if(p.second>todayTopCountMax){todayTopCountMax=p.second; todayTopDevice=p.first;} }
    for(auto &p: weekDev){ if(p.second>weekTopCountMax){weekTopCountMax=p.second; weekTopDevice=p.first;} }
    for(auto &p: monthDev){ if(p.second>monthTopCountMax){monthTopCountMax=p.second; monthTopDevice=p.first;} }

doc["today"]=todayCount;
    doc["week"]=weekCount;
    doc["month"]=monthCount;
    doc["todayTopDevice"]=todayTopDevice;
    doc["todayTopCount"]=todayTopCountMax;
    doc["weekTopDevice"]=weekTopDevice;
    doc["weekTopCount"]=weekTopCountMax;
    doc["monthTopDevice"]=monthTopDevice;
    doc["monthTopCount"]=monthTopCountMax;

    for(auto &item : stats){
        if(item.second.active && now>item.second.startTime)
            item.second.totalSeconds += (now-item.second.startTime);

        JsonObject d=devices.add<JsonObject>();
        d["name"]=item.first;
        d["onCount"]=item.second.onCount;
        d["offCount"]=item.second.offCount;
        float minutes=(float)item.second.totalSeconds/60.0f;
        d["minutes"]=minutes;
        d["avgMinutes"]=item.second.onCount ? minutes/item.second.onCount : 0;
    }

    String out;
    serializeJson(doc,out);
    return out;
}
